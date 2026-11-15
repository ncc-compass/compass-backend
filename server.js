const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();

app.use(cors()); 
app.use(express.json({ limit: '10mb' })); 

mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// --- GOOGLE SHEETS SETUP ---
function getGoogleAuth() {
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive'],
  });
}

async function backgroundSyncToGoogleSheet(courseId, courseData) {
  try {
    if (!process.env.GOOGLE_CREDENTIALS) return;
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });

    // 1. Find which Cohort this course belongs to
    const cohorts = await Cohort.find();
    let targetCohort = null;
    let targetCourseName = courseId;
    let studentRoster = [];
    
    for (let c of cohorts) {
      const match = c.courses.find(crs => crs.id === courseId);
      if (match) {
        targetCohort = c;
        targetCourseName = match.name;
        studentRoster = match.students || [];
        break;
      }
    }
    
    if (!targetCohort) return; 

    // 2. Search for the Spreadsheet YOU created and shared with the bot
    const sheetTitle = `Compass_Attendance_${targetCohort.name}`;
    let spreadsheetId = targetCohort.googleSheetId;

    if (!spreadsheetId) {
      const res = await drive.files.list({
        q: `name='${sheetTitle}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
        fields: 'files(id, name)',
      });

      if (res.data.files.length > 0) {
        spreadsheetId = res.data.files[0].id;
        // Save sheet ID back to Cohort so the bot never has to search for it again
        await Cohort.findOneAndUpdate({ cohortId: targetCohort.cohortId }, { $set: { googleSheetId: spreadsheetId } });
      } else {
        console.error(`\n=== ACTION REQUIRED ===\nThe spreadsheet "${sheetTitle}" was not found! Make sure you created it and shared it with the service account.\n`);
        return; // Exit safely without crashing
      }
    }

    // 3. Check if a Tab exists for this specific Course, if not create it
    const tabTitle = targetCourseName.substring(0, 31).replace(/[\]\[*?:\/']/g, ''); 
    const sheetDetails = await sheets.spreadsheets.get({ spreadsheetId });
    const existingTabs = sheetDetails.data.sheets.map(s => s.properties.title);

    if (!existingTabs.includes(tabTitle)) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{
            addSheet: { properties: { title: tabTitle } }
          }]
        }
      });
    }

    // 4. Format Data (Rows = Students, Cols = Sessions)
    const sessions = courseData.sessions || [];
    const records = courseData.records || {};
    const studentIds = Object.keys(records);

    let headerRow = ['Candidate ID', 'Student Name', ...sessions, 'Attendance %'];
    let rows = [headerRow];

    studentIds.forEach(stId => {
      const sRec = records[stId] || {};
      let attended = 0; let marked = 0;
      
      const stObj = studentRoster.find(s => String(s.id).trim() === String(stId).trim());
      const stName = stObj ? stObj.name : 'Unknown';

      let rowData = [stId, stName];
      
      sessions.forEach(date => {
        const status = sRec[date] || '';
        rowData.push(status);
        if (status !== '') {
          marked++;
          if (['Present', 'Late', 'Joined online'].includes(status)) attended++;
        }
      });

      const rate = marked > 0 ? Math.round((attended / marked) * 100) + '%' : 'N/A';
      rowData.push(rate);
      rows.push(rowData);
    });

    // 5. Update the specific Course Tab in the Cohort Spreadsheet
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabTitle}'!A1`,
      valueInputOption: 'USER_ENTERED',
      resource: { values: rows },
    });

  } catch (err) {
    console.error("Google Sheets Background Sync Error:", err);
  }
}

// --- SCHEMAS & APIs ---
const CourseSchema = new mongoose.Schema({
  courseId: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Course = mongoose.model('Course', CourseSchema);

const CohortSchema = new mongoose.Schema({
  cohortId: { type: String, unique: true },
  name: { type: String },
  courses: { type: mongoose.Schema.Types.Mixed, default: [] },
  googleSheetId: { type: String, default: '' } 
});
const Cohort = mongoose.model('Cohort', CohortSchema);

app.get('/api/db', async (req, res) => {
  try {
    const courses = await Course.find();
    let fullDB = {};
    courses.forEach(c => { fullDB[c.courseId] = c.data; });
    res.json(fullDB);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch database" });
  }
});

app.post('/api/update', async (req, res) => {
  try {
    const { courseId, courseData } = req.body;
    await Course.findOneAndUpdate(
      { courseId: courseId },
      { data: courseData },
      { upsert: true, new: true }
    );
    res.json({ success: true });
    
    // Trigger background sync without blocking response
    backgroundSyncToGoogleSheet(courseId, courseData);
  } catch (err) {
    res.status(500).json({ error: "Failed to update course" });
  }
});

const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  password: { type: String }, 
  name: { type: String },
  role: { type: String },
  editableCourses: { type: [String], default: [] }
});
const User = mongoose.model('User', UserSchema);

const CatalogSchema = new mongoose.Schema({
  courseId: { type: String, unique: true },
  name: { type: String },
  instructor: { type: String },
  stream: { type: String }
});
const Catalog = mongoose.model('Catalog', CatalogSchema);

app.get('/api/config', async (req, res) => {
  try {
    const users = await User.find({}, '-_id -__v');
    const catalogItems = await Catalog.find({}, '-_id -__v');
    let courseCatalog = {};
    catalogItems.forEach(item => {
      courseCatalog[item.courseId] = { name: item.name, instructor: item.instructor, stream: item.stream };
    });
    const cohorts = await Cohort.find({}, '-_id -__v');
    const formattedCohorts = cohorts.map(c => ({ id: c.cohortId, name: c.name, courses: c.courses }));
    res.json({ users: users, catalog: courseCatalog, cohorts: formattedCohorts });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch system config" });
  }
});

app.post('/api/seed-config', async (req, res) => {
  try {
    const { users, catalog, cohorts } = req.body;
    await User.deleteMany({});
    await Catalog.deleteMany({});
    await Cohort.deleteMany({});
    if (users && users.length > 0) await User.insertMany(users);
    if (catalog) {
      const catalogArr = Object.keys(catalog).map(key => ({
        courseId: key, name: catalog[key].name, instructor: catalog[key].instructor, stream: catalog[key].stream
      }));
      await Catalog.insertMany(catalogArr);
    }
    if (cohorts && cohorts.length > 0) {
      const cohortsArr = cohorts.map(c => ({ cohortId: c.id, name: c.name, courses: c.courses, googleSheetId: '' }));
      await Cohort.insertMany(cohortsArr);
    }
    res.json({ success: true, message: "Architecture Successfully Migrated!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to seed database" });
  }
});

app.post('/api/admin/bulk-users', async (req, res) => {
  try {
    const { users } = req.body;
    await User.deleteMany({});
    if (users && users.length > 0) await User.insertMany(users);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to bulk update users" });
  }
});

app.post('/api/admin/save-cohort', async (req, res) => {
  try {
    const { cohort } = req.body;
    await Cohort.findOneAndUpdate(
      { cohortId: cohort.id },
      { name: cohort.name, courses: cohort.courses },
      { upsert: true, new: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to save cohort matrix" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
