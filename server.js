const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();

// Allow requests from your GitHub Pages URL
app.use(cors()); 
app.use(express.json()); // Parses incoming JSON

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI, { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
}).then(() => console.log("MongoDB Connected"))
  .catch(err => console.log(err));

// Define Database Schema
const CourseSchema = new mongoose.Schema({
  courseId: { type: String, unique: true },
  data: { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Course = mongoose.model('Course', CourseSchema);

// GET API: Send entire database to the frontend on login
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

// POST API: Save updates to a specific course
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));