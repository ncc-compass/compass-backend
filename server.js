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
// 4. ADMIN DASHBOARD BULK APIs (NEW)
// ==========================================

// Bulk Save the Teacher/Admin Matrix
app.post('/api/admin/bulk-users', async (req, res) => {
  try {
    const { users } = req.body;
    
    // Wipe old users and insert the exact array sent from the frontend matrix
    await User.deleteMany({});
    if (users && users.length > 0) {
      await User.insertMany(users);
    }
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to bulk update users" });
  }
});

// Bulk Save a Cohort & Student Matrix
app.post('/api/admin/save-cohort', async (req, res) => {
  try {
    const { cohort } = req.body;
    
    // This safely updates an existing cohort if the ID matches, or creates a brand new one if it doesn't
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
