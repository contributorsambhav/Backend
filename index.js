// index.js
const express = require("express");
const { spawn } = require("child_process");
const cors = require("cors");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());
app.use(cors());
const schedulerDir = path.join(__dirname, "TrainScheduler");
const trainDataPath = path.join(schedulerDir, "train_data.json");
const outputPath = path.join(schedulerDir, "output.json");
const pythonScript = path.join(schedulerDir, "V3.py");

// Helper function to wait for file to exist and be readable
function waitForFile(filePath, maxWaitTime = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkFile = () => {
      try {
        if (fs.existsSync(filePath)) {
          // Check if file is readable and not empty
          const stats = fs.statSync(filePath);
          if (stats.size > 0) {
            // Try to read the file to ensure it's complete
            const content = fs.readFileSync(filePath, 'utf-8');
            JSON.parse(content); // Validate JSON
            resolve(content);
            return;
          }
        }
      } catch (err) {
        // File exists but might not be complete yet
      }
      
      if (Date.now() - startTime > maxWaitTime) {
        reject(new Error('Timeout waiting for output file'));
        return;
      }
      
      // Check again in 100ms
      setTimeout(checkFile, 100);
    };
    
    checkFile();
  });
}

app.post("/run", async (req, res) => {
  const inputData = req.body;

  try {
    // Ensure the scheduler directory exists
    if (!fs.existsSync(schedulerDir)) {
      return res.status(500).json({ error: "TrainScheduler directory not found" });
    }

    // Write input data
    fs.writeFileSync(trainDataPath, JSON.stringify(inputData, null, 2));

    // Remove existing output file if it exists
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }

    console.log(`Starting Python script: ${pythonScript}`);
    console.log(`Working directory: ${schedulerDir}`);
    console.log(`Expected output: ${outputPath}`);

    const pyProcess = spawn("python3", [pythonScript], { 
      cwd: schedulerDir,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdoutData = '';
    let stderrData = '';

    pyProcess.stdout.on("data", (data) => {
      const output = data.toString();
      stdoutData += output;
      console.log(`Python stdout: ${output}`);
    });

    pyProcess.stderr.on("data", (data) => {
      const error = data.toString();
      stderrData += error;
      console.error(`Python stderr: ${error}`);
    });

    pyProcess.on("close", async (code) => {
      console.log(`Python process exited with code: ${code}`);
      
      if (code !== 0) {
        console.error(`Python stderr output: ${stderrData}`);
        return res.status(500).json({ 
          error: `Python script exited with code ${code}`,
          stderr: stderrData,
          stdout: stdoutData
        });
      }

      try {
        // Wait for the output file to be created and populated
        console.log(`Waiting for output file: ${outputPath}`);
        const outputData = await waitForFile(outputPath);
        
        console.log("Successfully read output file");
        const result = {
          input: inputData,
          output: JSON.parse(outputData)
        };
        res.json(result);
      } catch (err) {
        console.error("Error reading output:", err);
        console.error("Files in scheduler directory:", fs.readdirSync(schedulerDir));
        
        res.status(500).json({ 
          error: "Failed to read output JSON",
          details: err.message,
          filesInDirectory: fs.readdirSync(schedulerDir),
          expectedFile: path.basename(outputPath),
          stdout: stdoutData,
          stderr: stderrData
        });
      }
    });

    pyProcess.on("error", (err) => {
      console.error("Failed to start Python process:", err);
      res.status(500).json({ 
        error: "Failed to start Python process",
        details: err.message
      });
    });

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ 
      error: "Server error",
      details: err.message
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  const checks = {
    schedulerDir: fs.existsSync(schedulerDir),
    pythonScript: fs.existsSync(pythonScript),
    filesInSchedulerDir: fs.existsSync(schedulerDir) ? fs.readdirSync(schedulerDir) : []
  };
  
  res.json({
    status: "ok",
    checks,
    paths: {
      schedulerDir,
      pythonScript,
      trainDataPath,
      outputPath
    }
  });
});

// Start server
const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`Backend running on http://localhost:${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/health`);
});