// Torque's page entry. Everything lives in app.js so a test script can import
// it and get the page's own instance: a driver script that imports the ENTRY
// module evaluates it a second time (ENGINE-ISSUES.md), which here built a
// second circuit and a second garage, parked a second car on the first one's
// spawn, and lifted the car under test off the road.
import "/app/app.js";
