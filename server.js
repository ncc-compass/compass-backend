const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Allow requests from your GitHub Pages URL
app.use(cors()); 
app.use(express.json({ limit: '10mb' })); // Increased limit slightly to handle the initial data seed

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// ==========================================
// 1. EXISTING ATTENDANCE SCHEMA (DO NOT TOUCH)
// ==========================================
const CourseSchema = new mongoose.Schema({
  courseId: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Course = mongoose.model('Course', CourseSchema);

// GET API: Send entire attendance database to frontend
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

// POST API: Save updates to a specific course's attendance
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
// 2. NEW SCHEMAS FOR PHASE 4 (USERS, CATALOG, COHORTS)
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
// 3. NEW APIs FOR SYSTEM CONFIGURATION
// ==========================================

// NEW GET API: Sends the Users, Catalog, and Cohorts to the frontend login screen
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

    res.json({
      users: users,
      catalog: courseCatalog,
      cohorts: formattedCohorts
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch system config" });
  }
});

// NEW POST API: A temporary endpoint to upload (seed) your static .js files into MongoDB
app.post('/api/seed-config', async (req, res) => {
  try {
    const { users, catalog, cohorts } = req.body;
    
    // Wipe only the structural tables to prevent duplicates (Attendance data remains safe)
    await User.deleteMany({});
    await Catalog.deleteMany({});
    await Cohort.deleteMany({});

    // Insert Users
    if (users && users.length > 0) await User.insertMany(users);
    
    // Insert Catalog
    if (catalog) {
      const catalogArr = Object.keys(catalog).map(key => ({
        courseId: key,
        name: catalog[key].name,
        instructor: catalog[key].instructor,
        stream: catalog[key].stream
      }));
      await Catalog.insertMany(catalogArr);
    }

    // Insert Cohorts
    if (cohorts && cohorts.length > 0) {
      const cohortsArr = cohorts.map(c => ({
        cohortId: c.id,
        name: c.name,
        courses: c.courses
      }));
      await Cohort.insertMany(cohortsArr);
    }

    res.json({ success: true, message: "Architecture Successfully Migrated to MongoDB!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to seed database" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
