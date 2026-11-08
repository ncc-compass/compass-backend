const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Allow requests from your GitHub Pages URL
app.use(cors()); 
app.use(express.json({ limit: '10mb' })); 

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// ==========================================
// 1. EXISTING ATTENDANCE SCHEMA
// ==========================================
const CourseSchema = new mongoose.Schema({
  courseId: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Course = mongoose.model('Course', CourseSchema);

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
  } catch (err) {
    res.status(500).json({ error: "Failed to update course" });
  }
});

// ==========================================
// 2. SYSTEM CONFIGURATION SCHEMAS
// ==========================================
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

const CohortSchema = new mongoose.Schema({
  cohortId: { type: String, unique: true },
  name: { type: String },
  courses: { type: mongoose.Schema.Types.Mixed, default: [] } 
});
const Cohort = mongoose.model('Cohort', CohortSchema);

// ==========================================
// 3. SYSTEM CONFIGURATION APIs
// ==========================================
app.get('/api/config', async (req, res) => {
  try {
    const users = await User.find({}, '-_id -__v');
    
    const catalogItems = await Catalog.find({}, '-_id -__v');
    let courseCatalog = {};
    catalogItems.forEach(item => {
      courseCatalog[item.courseId] = {
        name: item.name,
        instructor: item.instructor,
        stream: item.stream
      };
    });

    const cohorts = await Cohort.find({}, '-_id -__v');
    const formattedCohorts = cohorts.map(c => ({
      id: c.cohortId,
      name: c.name,
      courses: c.courses
    }));

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
        courseId: key,
        name: catalog[key].name,
        instructor: catalog[key].instructor,
        stream: catalog[key].stream
      }));
      await Catalog.insertMany(catalogArr);
    }

    if (cohorts && cohorts.length > 0) {
      const cohortsArr = cohorts.map(c => ({
        cohortId: c.id,
        name: c.name,
        courses: c.courses
      }));
      await Cohort.insertMany(cohortsArr);
    }

    res.json({ success: true, message: "Architecture Successfully Migrated!" });
  } catch (err) {
    res.status(500).json({ error: "Failed to seed database" });
  }
});

// ==========================================
// 4. ADMIN MANAGEMENT APIs (NEW)
// ==========================================

// Change a user password
app.post('/api/admin/update-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    await User.findOneAndUpdate({ username: username }, { password: newPassword });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update password" });
  }
});

// Create a blank new cohort
app.post('/api/admin/add-cohort', async (req, res) => {
  try {
    const { name } = req.body;
    const cohortId = "cohort_" + Date.now();
    const newCohort = new Cohort({
      cohortId: cohortId,
      name: name,
      courses: []
    });
    await newCohort.save();
    res.json({ success: true, cohortId: cohortId });
  } catch (err) {
    res.status(500).json({ error: "Failed to create cohort" });
  }
});

// Edit student and safely migrate all their attendance data
app.post('/api/admin/edit-student', async (req, res) => {
  try {
    const { cohortId, courseId, oldId, newId, newName } = req.body;

    // 1. Update the student's name and ID in the Course Roster
    const cohort = await Cohort.findOne({ cohortId: cohortId });
    if (cohort) {
      const course = cohort.courses.find(c => c.id === courseId);
      if (course) {
        const student = course.students.find(s => s.id === oldId);
        if (student) {
          student.id = newId;
          student.name = newName;
          cohort.markModified('courses');
          await cohort.save();
        }
      }
    }

    // 2. Cascade: If the ID changed, migrate their records, notes, and incidents
    if (oldId !== newId) {
      const attRecord = await Course.findOne({ courseId: courseId });
      if (attRecord && attRecord.data) {
        const data = attRecord.data;
        
        if (data.records && data.records[oldId]) {
          data.records[newId] = data.records[oldId];
          delete data.records[oldId];
        }
        if (data.incidents && data.incidents[oldId]) {
          data.incidents[newId] = data.incidents[oldId];
          delete data.incidents[oldId];
        }
        if (data.notes && data.notes[oldId]) {
          data.notes[newId] = data.notes[oldId];
          delete data.notes[oldId];
        }
        
        attRecord.markModified('data');
        await attRecord.save();
      }
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to update student data" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
