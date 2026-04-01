const fs = require('fs');
const FILE_PATH = 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

const targetStr = "// Initialize application when DOM is ready";
const startIdx = code.lastIndexOf(targetStr);

if (startIdx !== -1) {
    const newEnd = `// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    console.log("Script end reached. Scheduling init...");
    setTimeout(() => {
        if (window.app && window.app.init) {
            console.log("Triggering window.app.init()");
            window.app.init();
        }
    }, 100);
    if (window.app && window.app.initSecurity) window.app.initSecurity();
    if (window.app && window.app.initSync) window.app.initSync();
});
`;
    code = code.substring(0, startIdx) + newEnd;
    fs.writeFileSync(FILE_PATH, code);
    console.log("Successfully restored initialization logic at the end of script.js");
} else {
    console.log("Could not find the target string 'Initialize application when DOM is ready'");
}
