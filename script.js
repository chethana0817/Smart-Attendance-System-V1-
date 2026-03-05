// ================= FIREBASE INIT =================
const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  databaseURL: "",
  projectId: ""
};

if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);

const db = firebase.database();
const auth = firebase.auth();

let lastScanTime = 0;
let attendanceChart = null;
let editKey = null;
let modeResetTimer = null;

// ================= AUTH PROTECTION =================
if (typeof firebase !== "undefined") {
  firebase.auth().onAuthStateChanged(user => {
    if (!user && !location.pathname.includes("login.html")) {
      location.href = "login.html";
    }
  });
}

// ================= LOGIN =================
function login() {
  const email = emailInput.value;
  const pass = passwordInput.value;

  auth.signInWithEmailAndPassword(email, pass)
    .then(() => location.href = "dashboard.html")
    .catch(err => showToast(err.message));
}

function logout() {
  auth.signOut().then(() => {
    location.href = "login.html";
  });
}

// ================= TOAST =================
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) {
    t = document.createElement("div");
    t.id = "toast";
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.innerText = msg;
  t.style.display = "block";
  setTimeout(() => t.style.display = "none", 3000);
}

// ================= THEME =================
function toggleTheme() {
  document.body.classList.toggle("dark");
  localStorage.setItem("theme",
    document.body.classList.contains("dark") ? "dark" : "light");
}

// ================= AUTO INIT =================
document.addEventListener("DOMContentLoaded", () => {

  if (localStorage.getItem("theme") === "dark")
    document.body.classList.add("dark");

  if (document.getElementById("totalEmployees"))
    initDashboard();

  if (document.getElementById("employeeTable"))
    loadEmployees();

  if (document.getElementById("reportTable"))
    generateReport();

  listenDeviceStatus();
});

// ================= DEVICE STATUS =================
function listenDeviceStatus() {
  db.ref("device/status").on("value", snap => {
    const badge = document.getElementById("deviceStatus");
    if (!badge) return;
    const status = snap.val() || "offline";
    badge.innerText = status === "online" ? "Device Online" : "Device Offline";
    badge.className = "badge " + status;
  });
}

// ================= DASHBOARD =================
function initDashboard() {

  const today = new Date().toISOString().split("T")[0];

  db.ref("employees").on("value", empSnap => {

    const total = empSnap.exists()
      ? Object.keys(empSnap.val()).length
      : 0;

    document.getElementById("totalEmployees").innerText = total;

    db.ref("attendance/" + today).on("value", attSnap => {

      const present = attSnap.exists()
        ? Object.keys(attSnap.val()).length
        : 0;

      const absent = total - present;

      document.getElementById("presentCount").innerText = present;
      document.getElementById("absentCount").innerText = absent;

      updateDonut(total, present, absent);
      loadPresentList(attSnap);
    });
  });

  listenActivity();
  listenAttendance(); // 🔥 FIXED - THIS WAS MISSING
}

// ================= DONUT =================
function updateDonut(total, present, absent) {

  const ctx = document.getElementById("attendanceChart");
  if (!ctx) return;

  if (attendanceChart) attendanceChart.destroy();

  attendanceChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Present", "Absent"],
      datasets: [{
        data: [present, absent],
        backgroundColor: ["#2ecc71", "#e74c3c"]
      }]
    },
    options: {
      cutout: "70%",
      plugins: { legend: { display: false } }
    }
  });

  const percent = total === 0 ? 0 : Math.round((present / total) * 100);
  document.getElementById("donutCenter").innerText = percent + "%";
}

// ================= ATTENDANCE SCAN =================
function listenAttendance() {

  console.log("✅ Attendance listener active");

  db.ref("device/scanUID").on("value", async snap => {

    console.log("📡 Scan detected:", snap.val());

    const uid = snap.val();
    if (!uid) return;

    const now = Date.now();

    if (now - lastScanTime < 5000) {
      showToast("Please wait before scanning again");
      db.ref("device/scanUID").set("");
      return;
    }

    lastScanTime = now;

    const today = new Date().toISOString().split("T")[0];

    const empSnap = await db.ref("employees")
      .orderByChild("uid")
      .equalTo(uid)
      .once("value");

    if (!empSnap.exists()) {
      showToast("Unknown card");
      logActivity("Unknown card scanned");
      db.ref("device/scanUID").set("");
      return;
    }

    const key = Object.keys(empSnap.val())[0];
    const emp = empSnap.val()[key];

    const attendanceRef = db.ref("attendance/" + today + "/" + key);
    const existing = await attendanceRef.once("value");

    if (existing.exists()) {
      showToast(emp.name + " already marked present");
      logActivity(emp.name + " scanned again (ignored)");
      db.ref("device/scanUID").set("");
      return;
    }

    await attendanceRef.set({
      name: emp.name,
      employeeId: emp.employeeId,
      time: new Date().toLocaleTimeString()
    });

    showToast(emp.name + " marked present");
    logActivity(emp.name + " marked present");

    db.ref("device/scanUID").set("");
  });
}

// ================= PRESENT LIST =================
function loadPresentList(snapshot) {
  const list = document.getElementById("presentList");
  if (!list) return;

  list.innerHTML = "";

  if (!snapshot.exists()) return;

  Object.values(snapshot.val()).forEach(emp => {
    list.innerHTML += `
      <div class="list-item">
        <span>${emp.name}</span>
        <span>✔</span>
      </div>`;
  });
}

// ================= ACTIVITY =================
function logActivity(message) {
  db.ref("activity").push({
    message,
    time: new Date().toLocaleString()
  });
}

function listenActivity() {

  const container = document.getElementById("activityList");
  if (!container) return;

  db.ref("activity").limitToLast(10).on("value", snap => {

    container.innerHTML = "";

    if (!snap.exists()) return;

    Object.values(snap.val()).reverse().forEach(log => {
      container.innerHTML += `
        <div class="activity-item">
          <div>${log.message}</div>
          <small>${log.time}</small>
        </div>`;
    });
  });
}

// ================= EMPLOYEES =================
function loadEmployees() {

  db.ref("employees").on("value", snap => {

    const table = document.getElementById("employeeTable");
    if (!table) return;

    table.innerHTML = "";

    if (!snap.exists()) return;

    Object.entries(snap.val()).forEach(([key, emp]) => {

      table.innerHTML += `
        <tr>
          <td>${emp.name}</td>
          <td>${emp.employeeId}</td>
          <td>${emp.uid}</td>
          <td>
            <button onclick="editEmployee('${key}')">Edit</button>
            <button onclick="deleteEmployee('${key}')">Delete</button>
          </td>
        </tr>`;
    });
  });
}

async function saveEmployee() {

  const name = empName.value.trim();
  const id = empId.value.trim();
  const uid = empUid.value.trim();

  if (!name || !id || !uid) {
    showToast("Complete all fields");
    return;
  }

  const duplicateSnap = await db.ref("employees")
    .orderByChild("uid")
    .equalTo(uid)
    .once("value");

  if (duplicateSnap.exists() && !editKey) {
    showToast("This UID is already assigned!");
    return;
  }

  const data = { name, employeeId: id, uid };

  if (editKey) {
    await db.ref("employees/" + editKey).update(data);
    showToast("Employee updated");
    editKey = null;
  } else {
    await db.ref("employees").push(data);
    showToast("Employee added");
  }

  closeModal();
}

function editEmployee(key) {
  db.ref("employees/" + key).once("value").then(snap => {
    const emp = snap.val();
    empName.value = emp.name;
    empId.value = emp.employeeId;
    empUid.value = emp.uid;
    editKey = key;
    openModal();
  });
}

function deleteEmployee(key) {
  db.ref("employees/" + key).remove();
  showToast("Employee deleted");
}

// ================= MODAL =================
function openModal() {

  // 🔥 Clear fields when opening for new employee
  document.getElementById("empName").value = "";
  document.getElementById("empId").value = "";
  document.getElementById("empUid").value = "";

  editKey = null;

  employeeModal.style.display = "flex";
}

function closeModal() {

  // 🔥 Also clear when closing
  document.getElementById("empName").value = "";
  document.getElementById("empId").value = "";
  document.getElementById("empUid").value = "";

  editKey = null;

  employeeModal.style.display = "none";
}
// ================= ENROLL MODE =================
function startEnrollMode() {

  showToast("Enroll mode activated. Scan card...");

  if (modeResetTimer) clearTimeout(modeResetTimer);

  db.ref("device").update({
    mode: "enroll",
    enrollUID: ""
  });

  const enrollRef = db.ref("device/enrollUID");

  const listener = enrollRef.on("value", snap => {

    const uid = snap.val();
    if (!uid) return;

    // 🔥 THIS FILLS YOUR POPUP FIELD
    const uidInput = document.getElementById("empUid");
    if (uidInput) {
      uidInput.value = uid;
    }

    showToast("Card captured successfully");

    enrollRef.off("value", listener);

    modeResetTimer = setTimeout(() => {
      db.ref("device").update({
        mode: "attendance",
        enrollUID: ""
      });
      showToast("Back to attendance mode");
    }, 5000);
  });
}
// ================= TEST MODE =================
function startTestMode() {

  showToast("Test mode activated. Scan card...");

  if (modeResetTimer) clearTimeout(modeResetTimer);

  const resultDiv = document.getElementById("testResult");
  if (resultDiv) resultDiv.innerText = "Waiting for scan...";

  db.ref("device").update({
    mode: "test",
    scanUID: ""
  });

  const testRef = db.ref("device/scanUID");

  const listener = testRef.on("value", async snap => {

    const uid = snap.val();
    if (!uid) return;

    const empSnap = await db.ref("employees")
      .orderByChild("uid")
      .equalTo(uid)
      .once("value");

    if (!empSnap.exists()) {
      if (resultDiv) resultDiv.innerText = "❌ Unknown Card";
    } else {
      const emp = Object.values(empSnap.val())[0];
      if (resultDiv)
        resultDiv.innerText = "✅ " + emp.name + " (" + emp.employeeId + ")";
    }

    testRef.off("value", listener);

    modeResetTimer = setTimeout(() => {
      db.ref("device").update({
        mode: "attendance",
        scanUID: ""
      });

      if (resultDiv) resultDiv.innerText = "No Scan Yet";

      showToast("Back to attendance mode");
    }, 5000);
  });
}
// ================= SETTINGS PAGE FUNCTIONS =================

// 🔹 RESET TODAY
function resetToday() {

  const today = new Date().toISOString().split("T")[0];

  if (!confirm("Are you sure you want to reset today's attendance?")) return;

  db.ref("attendance/" + today).remove()
    .then(() => {
      showToast("Today's attendance reset successfully");
      logActivity("Attendance reset for " + today);
    })
    .catch(err => {
      showToast("Error resetting attendance");
      console.error(err);
    });
}


// 🔹 CLEAR SELECTED DATE
function clearSelectedDate() {

  const date = document.getElementById("clearDate").value;

  if (!date) {
    showToast("Please select a date");
    return;
  }

  if (!confirm("Clear attendance for " + date + "?")) return;

  db.ref("attendance/" + date).remove()
    .then(() => {
      showToast("Attendance cleared for " + date);
      logActivity("Attendance cleared for " + date);
    });
}


// 🔹 RESET ALL ATTENDANCE
function resetAll() {

  if (!confirm("This will delete ALL attendance data. Continue?")) return;

  db.ref("attendance").remove()
    .then(() => {
      showToast("All attendance data deleted");
      logActivity("All attendance reset");
    });
}


// 🔹 RESTART ESP32
function restartESP() {

  if (!confirm("Restart ESP32 device?")) return;

  db.ref("device").update({
    restart: true
  }).then(() => {
    showToast("Restart signal sent to ESP32");
    logActivity("ESP32 restart triggered");
  });
}


// 🔹 CLEAR ACTIVITY LOGS
function clearActivity() {

  if (!confirm("Clear all activity logs?")) return;

  db.ref("activity").remove()
    .then(() => {
      showToast("Activity logs cleared");
    });
}

// ================= REPORTS =================

let reportData = [];

async function generateReport() {

  const from = document.getElementById("fromDate")?.value;
  const to = document.getElementById("toDate")?.value;
  const table = document.getElementById("reportTable");

  if (!table) return;

  if (!from || !to) {
    showToast("Please select both dates");
    return;
  }

  table.innerHTML = "";
  reportData = [];

  const empSnap = await db.ref("employees").once("value");
  if (!empSnap.exists()) return;

  const employees = empSnap.val();

  let currentDate = new Date(from);
  const endDate = new Date(to);

  while (currentDate <= endDate) {

    const dateStr = currentDate.toISOString().split("T")[0];

    const attendanceSnap = await db.ref("attendance/" + dateStr).once("value");
    const attendance = attendanceSnap.exists() ? attendanceSnap.val() : {};

    Object.entries(employees).forEach(([empKey, emp]) => {

      let status = "Absent";
      let time = "-";

      if (attendance[empKey]) {
        status = "Present";
        time = attendance[empKey].time || "-";
      }

      reportData.push({
        date: dateStr,
        name: emp.name,
        employeeId: emp.employeeId,
        uid: emp.uid,
        status,
        time
      });

      table.innerHTML += `
        <tr>
          <td>${dateStr}</td>
          <td>${emp.name}</td>
          <td>${emp.employeeId}</td>
          <td>${emp.uid}</td>
          <td>${status}</td>
          <td>${time}</td>
        </tr>
      `;
    });

    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function downloadCSV() {

  if (reportData.length === 0) {
    showToast("No data to export");
    return;
  }

  let csv = "Date,Name,Employee ID,UID,Status,Time\n";

  reportData.forEach(row => {
    csv += `${row.date},${row.name},${row.employeeId},${row.uid},${row.status},${row.time}\n`;
  });

  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance_report.csv";
  a.click();
}

function downloadJSON() {

  if (reportData.length === 0) {
    showToast("No data to export");
    return;
  }

  const blob = new Blob(
    [JSON.stringify(reportData, null, 2)],
    { type: "application/json" }
  );

  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "attendance_report.json";
  a.click();
}