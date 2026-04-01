const fs = require('fs');
let s = fs.readFileSync('script.js', 'utf8');

// 1. Fix .await in code: this.await getAccessToken() -> this.getAccessToken()
// The Pass 2 already adds a leading await, so we just remove the redundant .await keyword.
s = s.replace(/\.await\s+/g, '.');

// 2. Fix await inside CSS strings: 'await translateY(-5px)' -> 'translateY(-5px)'
// Also handle other transform functions.
s = s.replace(/'await\s+(translateY|translateX|scale|rotate)/g, "'$1");

// 3. Fix app.await in HTML strings: onclick="app.await showBackupManager()"
s = s.replace(/app\.await\s+/g, 'app.');

// 4. Fix duplicated await: await await
s = s.replace(/\bawait\s+await\b/g, 'await');

// 5. Fix duplicated async: async async
s = s.replace(/\basync\s+async\s+/g, 'async ');

// 6. Fix await async: await async -> await
s = s.replace(/\bawait\s+async\s+/g, 'await ');

// 7. Fix onclick with await that are top-level
// This is more complex, but we'll try simple ones.
// Actually, let's leave them for now or fix only the ones we know.

fs.writeFileSync('script.js', s);
console.log("Cleanup complete.");
