const fs = require('fs');
const FILE_PATH = process.argv[2] || 'script.js';
let code = fs.readFileSync(FILE_PATH, 'utf8');

// Regex to find ANY onATTRIBUTE="await ..." or onATTRIBUTE='await ...'
// Pattern: on followed by any letters, then =, then quote, then optional async, then await
const regex = /(on[a-zA-Z]+)\s*=\s*(["'])(?:async\s+)?await\s+/g;

let count = 0;
const newCode = code.replace(regex, (match, event, quote) => {
    count++;
    return `${event}=${quote}`;
});

if (count > 0) {
    fs.writeFileSync(FILE_PATH, newCode);
    console.log(`Successfully removed ${count} additional incorrect await keywords from ALL HTML attributes in ${FILE_PATH}`);
} else {
    console.log(`No additional incorrect await keywords found in HTML attributes in ${FILE_PATH}`);
}
