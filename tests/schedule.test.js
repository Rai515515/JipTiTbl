/* Schedule test suite — loads the LIVE index.html inline script in a vm
   sandbox (no re-typed copy of the data) and asserts the 21.09.2026–
   17.10.2026 Theory Schedule circular (Third Floor LH-4) is represented
   exactly. Run: node tests/schedule.test.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const m = html.match(/<script>([\s\S]*?)<\/script>/);
if (!m) throw new Error("Could not find inline <script> in index.html");
const appSrc = m[1];

const sandbox = {
  document: { getElementById: () => ({ addEventListener: () => {} }) },
  localStorage: { getItem: () => null, setItem: () => {} },
  setInterval: () => 0,
  console,
};
sandbox.window = sandbox;
vm.createContext(sandbox);
// Run the app script (defines TH_SEP21, WEEK_SEP21, periodFor, etc.) then
// leak everything we need onto the sandbox object itself so Node can read it.
vm.runInContext(
  appSrc +
    `\nglobalThis.__T__ = { periodFor, thForIso, weekForIso, TH_SEP21, WEEK_SEP21,
      THEORY_PERIODS, pd, isoDate, fh, shr, h12parts, modularFor, MODULAR_TOPICS };`,
  sandbox
);
const T = sandbox.__T__;

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error("FAIL:", label); }
}
function eq(actual, expected, label) {
  ok(actual === expected, `${label} (expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)})`);
}

/* ── 1. date → weekday resolution (native Date is the calendar authority) ── */
function dow(iso) { return T.pd(iso).getDay(); } // 0=Sun..6=Sat
eq(dow("2026-09-21"), 1, "21 Sep 2026 is Monday");
eq(dow("2026-09-22"), 2, "22 Sep 2026 is Tuesday");
eq(dow("2026-09-23"), 3, "23 Sep 2026 is Wednesday");
eq(dow("2026-09-24"), 4, "24 Sep 2026 is Thursday");
eq(dow("2026-09-25"), 5, "25 Sep 2026 is Friday");
eq(dow("2026-09-26"), 6, "26 Sep 2026 is Saturday");
eq(dow("2026-09-27"), 0, "27 Sep 2026 is Sunday");
eq(dow("2026-10-17"), 6, "17 Oct 2026 is Saturday");

/* ── 2. minimum date-range tests from the task spec ── */
const IN_RANGE = [
  "2026-09-21","2026-09-22","2026-09-23","2026-09-24","2026-09-25","2026-09-26","2026-09-27",
  "2026-09-28","2026-10-01","2026-10-17",
];
IN_RANGE.forEach(iso => {
  const p = T.periodFor(iso);
  ok(p && p.from === "2026-09-21" && p.to === "2026-10-17", `${iso} resolves to the 21.09-17.10.2026 period`);
});
const OUT_OF_RANGE = ["2026-10-18","2026-09-20"];
OUT_OF_RANGE.forEach(iso => {
  const p = T.periodFor(iso);
  ok(!p || (p.from !== "2026-09-21" || p.to !== "2026-10-17"), `${iso} must NOT receive the 21.09-17.10.2026 timetable`);
});
// 20 Sep and 18 Oct explicitly must not carry ANY class from this schedule window
ok(T.periodFor("2026-10-18") === null, "18 Oct 2026 has no confirmed schedule (outside every period)");

/* ── 3. Sunday = no classes throughout the window ── */
["2026-09-27","2026-10-04","2026-10-11"].forEach(iso => {
  const TH = T.thForIso(iso);
  const slots = TH ? (TH[0] || []) : [];
  eq(slots.length, 0, `${iso} (Sunday) has no classes`);
});

/* ── 4. exact per-weekday period mapping, TH_SEP21 (venue Third Floor LH-4) ── */
const per = T.THEORY_PERIODS.find(p => p.from === "2026-09-21");
eq(per.venue, "Third Floor LH-4", "Venue is Third Floor LH-4");

function findAt(daySlots, clock) {
  return daySlots.find(s => clock >= s.s && clock < s.e) || null;
}
const P = { p1: 9, p2: 12, p3: 14.25, p4: 15.25, p5: 16.25 };

const EXPECT = {
  1: { name: "Monday",    p1: "Clinics", p2: "ENT",     p3: "Modular Teaching", p4: "Modular Teaching", p5: "Medicine" },
  2: { name: "Tuesday",   p1: "Clinics", p2: "PSM",     p3: "Modular Teaching", p4: "Modular Teaching", p5: "Dermatology" },
  3: { name: "Wednesday", p1: "Clinics", p2: "ENT",     p3: "FHAP",             p4: "FHAP",              p5: null },
  4: { name: "Thursday",  p1: "Clinics", p2: "Surgery", p3: "Surgery",          p4: "OBG",               p5: "Ophthalmology" },
  5: { name: "Friday",    p1: "Clinics", p2: "ENT",     p3: "Modular Teaching", p4: "Modular Teaching", p5: "Ophthalmology" },
  6: { name: "Saturday",  p1: "Clinics", p2: "OBG",     p3: null,               p4: null,                p5: null },
};

for (const dowNum of [1,2,3,4,5,6]) {
  const exp = EXPECT[dowNum];
  const daySlots = T.TH_SEP21[dowNum];
  for (const pk of ["p1","p2","p3","p4","p5"]) {
    const clock = P[pk];
    const found = findAt(daySlots, clock);
    const gotSub = found ? found.sub : null;
    eq(gotSub, exp[pk], `${exp.name} @ ${T.fh(clock)} (${pk})`);
  }
}
// Sunday: everything empty
eq((T.TH_SEP21[0] || []).length, 0, "Sunday has no TH_SEP21 entries");

/* ── 5. the 13:00-14:15 gap must stay empty (no class created in it) ── */
for (const dowNum of [1,2,3,4,5,6]) {
  const bad = T.TH_SEP21[dowNum].find(s => s.s < 14.25 && s.e > 13 && s.s >= 13);
  ok(!bad, `${EXPECT[dowNum].name}: no class created in the 13:00-14:15 gap`);
}

/* ── 6. exact time values, not rounded (2:15/3:15/4:15 must stay :15, never :00) ── */
[1,2,5].forEach(d => {
  const mod = T.TH_SEP21[d].find(s => s.sub === "Modular Teaching");
  eq(mod.s, 14.25, `${EXPECT[d].name} Modular Teaching starts at 14.25 (2:15 PM), not rounded`);
  eq(mod.e, 16.25, `${EXPECT[d].name} Modular Teaching ends at 16.25 (4:15 PM), not rounded`);
});
const fhap = T.TH_SEP21[3].find(s => s.sub === "FHAP");
eq(fhap.s, 14.25, "Wednesday FHAP starts at 14.25 (2:15 PM)");
eq(fhap.e, 16.25, "Wednesday FHAP ends at 16.25 (4:15 PM), covering both merged periods");
eq(T.fh(14.25), "2:15 PM", "fh(14.25) formats as 2:15 PM");
eq(T.fh(15.25), "3:15 PM", "fh(15.25) formats as 3:15 PM");
eq(T.fh(16.25), "4:15 PM", "fh(16.25) formats as 4:15 PM");
eq(T.shr(14.25, 16.25), "2:15–4:15", "shr(14.25,16.25) formats merged block correctly");

/* ── 7. current-class boundary precision (no off-by-one-minute errors) ── */
// Monday Modular Teaching / Medicine boundary
const mon = T.TH_SEP21[1];
eq(findAt(mon, 14 + 14/60), null, "14:14 -> no afternoon class yet (Monday)");
eq(findAt(mon, 14.25).sub, "Modular Teaching", "14:15 exactly -> Modular Teaching starts (Monday)");
eq(findAt(mon, 15 + 14/60).sub, "Modular Teaching", "15:14 -> Modular Teaching still active (Monday)");
eq(findAt(mon, 16.25).sub, "Medicine", "16:15 exactly -> Medicine starts (Monday)");
eq(findAt(mon, 16 + 14/60).sub, "Modular Teaching", "16:14 -> still Modular Teaching, not yet Medicine (Monday)");
// Thursday's non-merged 14:15/15:15 boundary (Surgery -> OBG)
const thu = T.TH_SEP21[4];
eq(findAt(thu, 15 + 14/60).sub, "Surgery", "15:14 -> Surgery still active (Thursday)");
eq(findAt(thu, 15.25).sub, "OBG", "15:15 exactly -> OBG starts (Thursday)");

/* ── 8. data-integrity check: 104 occupied period-slots over the window ── */
const PERIOD_BOUNDS = [[9,12],[12,13],[14.25,15.25],[15.25,16.25],[16.25,17.25]];
let occupied = 0;
let d = new Date(2026, 8, 21); // 21 Sep 2026
const end = new Date(2026, 9, 17); // 17 Oct 2026
while (d <= end) {
  const wd = d.getDay();
  if (wd !== 0) {
    const daySlots = T.TH_SEP21[wd] || [];
    for (const [bs, be] of PERIOD_BOUNDS) {
      if (daySlots.some(s => s.s <= bs && s.e >= be)) occupied++;
    }
  }
  d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}
eq(occupied, 104, "Exactly 104 occupied period-slots across 21.09-17.10.2026 (4 complete Mon-Sat cycles)");

/* ── 9. subject-name preservation (no renaming of official abbreviations) ── */
const allSubs = new Set();
[1,2,3,4,5,6].forEach(dw => T.TH_SEP21[dw].forEach(s => allSubs.add(s.sub)));
ok(allSubs.has("OBG") && !allSubs.has("Obstetrics & Gynaecology"), "OBG kept as the official abbreviation, not expanded");
ok(allSubs.has("ENT"), "ENT preserved");
ok(allSubs.has("PSM"), "PSM preserved");
ok(allSubs.has("FHAP"), "FHAP preserved");
ok(allSubs.has("Modular Teaching"), "Modular Teaching preserved");

/* ── 10. Modular Teaching circular (18.09.2026): 11 date-specific overrides ── */
const MODULAR_DATES = {
  "2026-09-21": { weekday: 1, topic: "Pelvic Radiation Oncology",     dept: "Radiation Oncology", venue: "LH-4, Third Floor",  streaming: true },
  "2026-09-22": { weekday: 2, topic: "Pelvic Radiation Oncology",     dept: "Radiation Oncology", venue: "LH-4, Third Floor",  streaming: true },
  "2026-09-25": { weekday: 5, topic: "Pelvic Radiation Oncology",     dept: "Radiation Oncology", venue: "LH-4, Third Floor",  streaming: true },
  "2026-09-28": { weekday: 1, topic: "Transfusion Medicine",          dept: "Pathology",          venue: "LH-5, Fourth Floor", streaming: false },
  "2026-09-29": { weekday: 2, topic: "Transfusion Medicine",          dept: "Pathology",          venue: "LH-5, Fourth Floor", streaming: false },
  "2026-10-05": { weekday: 1, topic: "Basics of Oncology",            dept: "Medical Oncology",   venue: "LH-4, Third Floor",  streaming: true },
  "2026-10-06": { weekday: 2, topic: "Basics of Oncology",            dept: "Medical Oncology",   venue: "LH-4, Third Floor",  streaming: true },
  "2026-10-09": { weekday: 5, topic: "Basics of Oncology",            dept: "Medical Oncology",   venue: "LH-4, Third Floor",  streaming: true },
  "2026-10-12": { weekday: 1, topic: "Falls in Geriatric Population", dept: "Geriatric Medicine", venue: "LH-4, Third Floor",  streaming: true },
  "2026-10-13": { weekday: 2, topic: "Falls in Geriatric Population", dept: "Geriatric Medicine", venue: "LH-4, Third Floor",  streaming: true },
  "2026-10-16": { weekday: 5, topic: "Falls in Geriatric Population", dept: "Geriatric Medicine", venue: "LH-4, Third Floor",  streaming: true },
};

// Independently verify weekday for every listed date against the native calendar
for (const iso in MODULAR_DATES) {
  eq(dow(iso), MODULAR_DATES[iso].weekday, `${iso} weekday matches the calendar`);
}

for (const iso in MODULAR_DATES) {
  const exp = MODULAR_DATES[iso];
  const md = T.modularFor(iso);
  ok(md, `${iso} has a MODULAR_TOPICS record`);
  eq(md.topic, exp.topic, `${iso} topic`);
  eq(md.dept, exp.dept, `${iso} department`);
  eq(md.venue, exp.venue, `${iso} venue`);
  eq(md.streaming, exp.streaming, `${iso} streaming flag`);

  // effective (overridden) TH slot for this specific date
  const TH = T.thForIso(iso);
  const daySlots = TH[exp.weekday];
  const modSlot = daySlots.find(s => s.type === "modular");
  ok(modSlot, `${iso} has a modular TH slot`);
  eq(modSlot.s, 14, `${iso} modular slot starts at 14 (2:00 PM), overriding the generic 2:15 PM`);
  eq(modSlot.e, 16.25, `${iso} modular slot ends at 16.25 (4:15 PM)`);
  eq(T.fh(modSlot.s), "2:00 PM", `${iso} formats as 2:00 PM`);
  eq(T.fh(modSlot.e), "4:15 PM", `${iso} formats as 4:15 PM`);

  // exactly one modular entry per day (no duplicate generic + specific event)
  const modularEntries = daySlots.filter(s => s.type === "modular");
  eq(modularEntries.length, 1, `${iso} has exactly one Modular Teaching entry, not a duplicate`);

  // surrounding classes (Clinics/ENT-or-PSM/afternoon subject) are untouched
  eq(daySlots.find(s => s.sub === "Clinics").s, 9, `${iso} Clinics still 9:00-12:00`);
  const noonSub = exp.weekday === 2 ? "PSM" : "ENT";
  ok(daySlots.some(s => s.sub === noonSub && s.s === 12 && s.e === 13), `${iso} 12:00-13:00 ${noonSub} unchanged`);
  const lateSub = { 1: "Medicine", 2: "Dermatology", 5: "Ophthalmology" }[exp.weekday];
  ok(daySlots.some(s => s.sub === lateSub && s.s === 16.25 && s.e === 17.25), `${iso} 16:15-17:15 ${lateSub} unchanged`);

  // the WEEK grid's override is likewise scoped to this date, not the whole weekday
  const WK = T.weekForIso(iso);
  const weekModular = WK[exp.weekday].filter(s => s.vt === "modular");
  eq(weekModular.length, 2, `${iso} WEEK grid still has 2 modular rows (split, unchanged count)`);
  eq(weekModular[0].s, 14, `${iso} WEEK grid's first modular row starts at 14 (2:00 PM)`);
  eq(weekModular[1].s, 15.25, `${iso} WEEK grid's second modular row still starts at 15.25 (3:15 PM)`);
}

// count validation: exactly 11 records, grouped exactly as specified
eq(Object.keys(T.MODULAR_TOPICS).length, 11, "Exactly 11 modular-topic records exist");
function topicCount(name) { return Object.values(T.MODULAR_TOPICS).filter(m => m.topic === name).length; }
eq(topicCount("Pelvic Radiation Oncology"), 3, "Pelvic Radiation Oncology = 3 dates");
eq(topicCount("Transfusion Medicine"), 2, "Transfusion Medicine = 2 dates");
eq(topicCount("Basics of Oncology"), 3, "Basics of Oncology = 3 dates");
eq(topicCount("Falls in Geriatric Population"), 3, "Falls in Geriatric Population = 3 dates");

/* ── 11. range validation: the override never leaks outside its 11 dates ── */
const NOT_MODULAR = [
  "2026-09-20","2026-09-23","2026-09-24","2026-09-26","2026-09-27",
  "2026-09-30","2026-10-02","2026-10-07","2026-10-10","2026-10-14","2026-10-15","2026-10-17",
];
NOT_MODULAR.forEach(iso => {
  ok(!T.modularFor(iso), `${iso} has no modular-topic record (not one of the 11 dates)`);
});
// 02 Oct 2026 is a Friday inside the window with a generic (unoverridden) Modular Teaching slot
const oct02TH = T.thForIso("2026-10-02");
eq(dow("2026-10-02"), 5, "02 Oct 2026 is a Friday");
const oct02Mod = oct02TH[5].find(s => s.type === "modular");
eq(oct02Mod.s, 14.25, "02 Oct 2026 keeps the generic 2:15 PM start (not in the modular circular)");
eq(oct02Mod.e, 16.25, "02 Oct 2026 modular slot still ends 4:15 PM");

/* ── 12. unaffected weekdays around the modular dates stay exactly as before ── */
const UNAFFECTED = [
  ["2026-09-23","FHAP"],["2026-09-24",null],["2026-09-30","FHAP"],["2026-10-01",null],
  ["2026-10-07","FHAP"],["2026-10-08",null],["2026-10-14","FHAP"],["2026-10-15",null],
];
UNAFFECTED.forEach(([iso, fhapExpected]) => {
  const wd = dow(iso);
  const TH = T.thForIso(iso);
  if (fhapExpected) {
    ok(TH[wd].some(s => s.sub === "FHAP" && s.s === 14.25 && s.e === 16.25), `${iso} FHAP unchanged (14:15-16:15)`);
  } else {
    // Thursday: Surgery/Surgery/OBG/Ophthalmology unchanged
    ok(TH[wd].some(s => s.sub === "Surgery" && s.s === 14.25 && s.e === 15.25), `${iso} Thursday Surgery period unchanged`);
    ok(TH[wd].some(s => s.sub === "OBG" && s.s === 15.25 && s.e === 16.25), `${iso} Thursday OBG unchanged`);
    ok(TH[wd].some(s => s.sub === "Ophthalmology" && s.s === 16.25 && s.e === 17.25), `${iso} Thursday Ophthalmology unchanged`);
  }
});
["2026-09-26","2026-10-10","2026-10-17"].forEach(iso => {
  const wd = dow(iso);
  eq(wd, 6, `${iso} is Saturday`);
  const TH = T.thForIso(iso);
  ok(TH[wd].some(s => s.sub === "OBG" && s.s === 12 && s.e === 13), `${iso} Saturday OBG unchanged`);
  ok(!TH[wd].some(s => s.s >= 14.25), `${iso} Saturday still has nothing after 13:00`);
});

/* ── summary ── */
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
