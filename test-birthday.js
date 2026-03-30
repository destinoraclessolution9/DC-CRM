
const getBdayMMDD = (dateStr) => {
    if (!dateStr) return null;
    const cleaned = dateStr.trim().replace(/\s+/g, '');
    const parts = cleaned.split(/[-\/]/); 
    if (parts.length >= 2) {
        const mm = parts[parts.length - 2].padStart(2, '0');
        const dd = parts[parts.length - 1].padStart(2, '0');
        if (parseInt(mm) >= 1 && parseInt(mm) <= 12 && parseInt(dd) >= 1 && parseInt(dd) <= 31) {
            return `${mm}-${dd}`;
        }
    }
    return null;
};

const mmdd = (d) => `${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;

const testCases = [
    { input: '1990-03-12', expected: '03-12' },
    { input: '03-12', expected: '03-12' },
    { input: '1990/03/12', expected: '03-12' },
    { input: '03/12', expected: '03-12' },
    { input: '  2000 - 05 - 20  ', expected: '05-20' },
    { input: 'INVALID', expected: null },
    { input: '2024-02-29', expected: '02-29' },
    { input: '12-31-1990', expected: '31-1990' }, // Wait, if DD-MM-YYYY, it gets MM-YYYY?
];

console.log('Testing getBdayMMDD:');
testCases.forEach(tc => {
    const result = getBdayMMDD(tc.input);
    const passed = result === tc.expected;
    console.log(`Input: "${tc.input}" -> Result: "${result}" [${passed ? 'PASS' : 'FAIL, expected ' + tc.expected}]`);
});

const today = new Date('2026-03-12'); // Fixed date for testing
console.log('\nTesting Today/Upcoming comparison (Today is 2026-03-12):');
const todayStr = mmdd(today);
const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
const tomorrowStr = mmdd(tomorrow);
const day2 = new Date(today); day2.setDate(today.getDate() + 2);
const day2Str = mmdd(day2);

console.log('Today:', todayStr);
console.log('Tomorrow:', tomorrowStr);
console.log('Day 2:', day2Str);

const contacts = [
    { name: 'Alice', dob: '1990-03-12' },
    { name: 'Bob', dob: '03-13' },
    { name: 'Charlie', dob: '2000/03/14' },
    { name: 'David', dob: '03-15' }
];

contacts.forEach(c => {
    const bday = getBdayMMDD(c.dob);
    let status = 'Not upcoming';
    if (bday === todayStr) status = 'TODAY';
    else if (bday === tomorrowStr || bday === day2Str) status = 'UPCOMING';
    console.log(`${c.name} (${c.dob}) -> Bday: ${bday} -> Status: ${status}`);
});
