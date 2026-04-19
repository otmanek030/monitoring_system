import { useState } from "react";

// ─── OCP Brand Colors ───────────────────────────────────────────────────────
// Primary green: #1A7A3C  |  Light green: #4CAF50  |  Accent: #8DC63F
// Dark bg: #0F2D1A        |  Card bg: #F4F9F5       |  Text: #1C1C1C

const ROLES = {
  admin: {
    key: "admin",
    label: "Administrator",
    icon: "🛡️",
    color: "#0F2D1A",
    accent: "#1A7A3C",
    badge: "#8DC63F",
    description: "Full system control — manages users, configurations, and all data.",
    tasks: [
      {
        category: "User Management",
        icon: "👥",
        items: [
          "Create, edit and delete user accounts",
          "Assign and revoke roles (Admin, Supervisor, Technician, Operator)",
          "Reset passwords and manage sessions",
          "View audit logs of all user actions",
        ],
      },
      {
        category: "System Configuration",
        icon: "⚙️",
        items: [
          "Configure alert thresholds for all equipment",
          "Set up OPC UA / Modbus / SCADA data sources",
          "Manage Docker service health and restarts",
          "Configure AI model parameters and retraining schedules",
        ],
      },
      {
        category: "Data & Reports",
        icon: "📊",
        items: [
          "Export all data to Excel / PDF",
          "Access full historical trend analysis",
          "View and manage all AI prediction outputs",
          "Delete or archive sensor data records",
        ],
      },
      {
        category: "Alerts & Notifications",
        icon: "🔔",
        items: [
          "Create and manage alert rules for all roles",
          "Configure notification channels (email, SMS)",
          "Override or silence any system alert",
          "View complete alert history",
        ],
      },
    ],
  },
  supervisor: {
    key: "supervisor",
    label: "Supervisor",
    icon: "📋",
    color: "#1A4D2E",
    accent: "#2E7D52",
    badge: "#4CAF50",
    description: "Strategic oversight — monitors performance, reviews predictions, approves reports.",
    tasks: [
      {
        category: "Dashboard & Monitoring",
        icon: "📡",
        items: [
          "View all equipment real-time dashboards",
          "Monitor KPIs across the entire plant",
          "Access all historical trend charts",
          "Compare performance across equipment groups",
        ],
      },
      {
        category: "AI Insights",
        icon: "🤖",
        items: [
          "Review anomaly detection results",
          "View predictive maintenance forecasts (7–14 days)",
          "Consult RUL (Remaining Useful Life) predictions",
          "Validate or flag AI recommendations",
        ],
      },
      {
        category: "Reports & Exports",
        icon: "📄",
        items: [
          "Generate and export Excel / PDF reports",
          "Approve maintenance reports from technicians",
          "Review shift notes and incident reports",
          "Schedule automated periodic reports",
        ],
      },
      {
        category: "Alerts",
        icon: "🔔",
        items: [
          "Acknowledge and escalate critical alerts",
          "View all active and historical alerts",
          "Assign alert investigation to a technician",
        ],
      },
    ],
  },
  technician: {
    key: "technician",
    label: "Technician",
    icon: "🔧",
    color: "#1C3A28",
    accent: "#388E3C",
    badge: "#66BB6A",
    description: "Maintenance expert — acts on AI predictions, logs interventions, manages equipment health.",
    tasks: [
      {
        category: "Equipment Maintenance",
        icon: "🛠️",
        items: [
          "View AI-predicted failure alerts with priority",
          "Log maintenance interventions with details",
          "Update equipment status after repair",
          "Schedule planned maintenance tasks",
        ],
      },
      {
        category: "AI Predictions",
        icon: "🤖",
        items: [
          "Access anomaly detection details per sensor",
          "View RUL predictions for assigned equipment",
          "Consult predictive maintenance timeline",
          "Mark predictions as actioned or deferred",
        ],
      },
      {
        category: "Reporting",
        icon: "📝",
        items: [
          "Create detailed maintenance reports",
          "Document parts replaced and actions taken",
          "Export equipment health summaries to PDF",
          "View history of past interventions",
        ],
      },
      {
        category: "Alerts",
        icon: "🔔",
        items: [
          "Acknowledge maintenance-related alerts",
          "Close resolved alert tickets",
          "Add technical notes to alert records",
        ],
      },
    ],
  },
  operator: {
    key: "operator",
    label: "Operator",
    icon: "👁️",
    color: "#1E3A2F",
    accent: "#43A047",
    badge: "#81C784",
    description: "Real-time watchman — monitors live data, logs observations, raises issues immediately.",
    tasks: [
      {
        category: "Live Monitoring",
        icon: "📡",
        items: [
          "View real-time equipment dashboard (gauges, charts)",
          "Monitor sensor readings during shift",
          "Track equipment operational status",
          "View active alerts on assigned equipment",
        ],
      },
      {
        category: "Shift Notes",
        icon: "📓",
        items: [
          "Write and save shift observation notes",
          "Add timestamped notes to specific equipment",
          "Review notes from previous shift handover",
          "Tag notes by equipment or severity",
        ],
      },
      {
        category: "Incident Reports",
        icon: "⚠️",
        items: [
          "Submit incident reports for abnormal behavior",
          "Attach sensor screenshots to reports",
          "Track status of submitted reports",
          "View plant incident history",
        ],
      },
      {
        category: "Alerts & Requests",
        icon: "🔔",
        items: [
          "Acknowledge alerts to confirm awareness",
          "Send maintenance requests to technicians",
          "Escalate urgent issues to supervisor",
          "Receive alert notifications in real-time",
        ],
      },
    ],
  },
};

// ─── Permission Matrix ────────────────────────────────────────────────────────
const PERMISSION_MATRIX = [
  { action: "View live dashboard",       admin: true,  supervisor: true,  technician: true,  operator: true  },
  { action: "Acknowledge alerts",        admin: true,  supervisor: true,  technician: true,  operator: true  },
  { action: "Write shift notes",         admin: true,  supervisor: false, technician: false, operator: true  },
  { action: "Submit incident report",    admin: true,  supervisor: false, technician: false, operator: true  },
  { action: "Request maintenance",       admin: true,  supervisor: false, technician: false, operator: true  },
  { action: "Log maintenance work",      admin: true,  supervisor: false, technician: true,  operator: false },
  { action: "View AI predictions",       admin: true,  supervisor: true,  technician: true,  operator: false },
  { action: "Validate AI results",       admin: true,  supervisor: true,  technician: true,  operator: false },
  { action: "Export Excel / PDF",        admin: true,  supervisor: true,  technician: true,  operator: false },
  { action: "Approve reports",           admin: true,  supervisor: true,  technician: false, operator: false },
  { action: "Configure alert rules",     admin: true,  supervisor: false, technician: false, operator: false },
  { action: "Manage users & roles",      admin: true,  supervisor: false, technician: false, operator: false },
  { action: "Configure data sources",    admin: true,  supervisor: false, technician: false, operator: false },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function RoleCard({ role, isActive, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: isActive ? role.accent : "#fff",
        border: `2px solid ${isActive ? role.accent : "#D1E8D5"}`,
        borderRadius: "14px",
        padding: "18px 22px",
        cursor: "pointer",
        transition: "all 0.25s ease",
        textAlign: "left",
        width: "100%",
        boxShadow: isActive ? `0 4px 18px ${role.accent}55` : "0 2px 8px #00000010",
        transform: isActive ? "translateY(-2px)" : "none",
      }}
    >
      <div style={{ fontSize: "28px", marginBottom: "6px" }}>{role.icon}</div>
      <div style={{ fontWeight: "700", fontSize: "15px", color: isActive ? "#fff" : "#1C1C1C" }}>
        {role.label}
      </div>
      <div
        style={{
          fontSize: "11px",
          marginTop: "4px",
          color: isActive ? "rgba(255,255,255,0.85)" : "#6B7F6E",
          lineHeight: "1.4",
        }}
      >
        {role.description}
      </div>
      <div
        style={{
          marginTop: "10px",
          display: "inline-block",
          background: isActive ? "rgba(255,255,255,0.2)" : role.badge + "30",
          color: isActive ? "#fff" : role.accent,
          fontSize: "10px",
          fontWeight: "600",
          padding: "3px 10px",
          borderRadius: "20px",
          letterSpacing: "0.5px",
          textTransform: "uppercase",
        }}
      >
        {role.tasks.reduce((acc, t) => acc + t.items.length, 0)} capabilities
      </div>
    </button>
  );
}

function TaskSection({ category, icon, items, accent }) {
  const [open, setOpen] = useState(true);
  return (
    <div
      style={{
        background: "#fff",
        border: `1px solid #D1E8D5`,
        borderRadius: "12px",
        overflow: "hidden",
        marginBottom: "12px",
      }}
    >
      <button
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          background: "none",
          border: "none",
          padding: "14px 18px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          borderBottom: open ? "1px solid #E8F3EA" : "none",
        }}
      >
        <span style={{ fontSize: "18px" }}>{icon}</span>
        <span style={{ fontWeight: "700", color: "#1A7A3C", fontSize: "14px", flex: 1, textAlign: "left" }}>
          {category}
        </span>
        <span style={{ color: "#4CAF50", fontSize: "12px" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <ul style={{ margin: 0, padding: "12px 18px 14px 18px", listStyle: "none" }}>
          {items.map((item, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                padding: "7px 0",
                borderBottom: i < items.length - 1 ? "1px solid #F0F7F1" : "none",
                fontSize: "13.5px",
                color: "#2D3B2E",
                lineHeight: "1.5",
              }}
            >
              <span
                style={{
                  width: "7px",
                  height: "7px",
                  minWidth: "7px",
                  background: accent,
                  borderRadius: "50%",
                  marginTop: "6px",
                }}
              />
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PermissionMatrix({ activeRole }) {
  const roles = ["admin", "supervisor", "technician", "operator"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
        <thead>
          <tr>
            <th
              style={{
                padding: "12px 16px",
                textAlign: "left",
                background: "#0F2D1A",
                color: "#8DC63F",
                borderRadius: "10px 0 0 0",
                fontWeight: "700",
                fontSize: "13px",
              }}
            >
              Action / Capability
            </th>
            {roles.map((r) => (
              <th
                key={r}
                style={{
                  padding: "12px 10px",
                  textAlign: "center",
                  background: r === activeRole ? ROLES[r].accent : "#0F2D1A",
                  color: r === activeRole ? "#fff" : "#8DC63F",
                  fontWeight: "700",
                  fontSize: "12px",
                  minWidth: "90px",
                  transition: "background 0.3s",
                }}
              >
                {ROLES[r].icon} {ROLES[r].label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {PERMISSION_MATRIX.map((row, i) => (
            <tr
              key={i}
              style={{ background: i % 2 === 0 ? "#F4F9F5" : "#fff" }}
            >
              <td
                style={{
                  padding: "10px 16px",
                  color: "#1C1C1C",
                  fontWeight: "500",
                  borderBottom: "1px solid #E8F3EA",
                }}
              >
                {row.action}
              </td>
              {roles.map((r) => (
                <td
                  key={r}
                  style={{
                    textAlign: "center",
                    padding: "10px",
                    borderBottom: "1px solid #E8F3EA",
                    background:
                      r === activeRole
                        ? row[r]
                          ? "#E8F5E9"
                          : "#FFEBEE"
                        : "transparent",
                    transition: "background 0.3s",
                  }}
                >
                  {row[r] ? (
                    <span style={{ color: "#2E7D32", fontSize: "16px", fontWeight: "700" }}>✓</span>
                  ) : (
                    <span style={{ color: "#BDBDBD", fontSize: "14px" }}>—</span>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function RolePermissions() {
  const [activeRole, setActiveRole] = useState("admin");
  const [activeTab, setActiveTab] = useState("tasks"); // "tasks" | "matrix"
  const role = ROLES[activeRole];

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(135deg, #F4F9F5 0%, #E8F5E9 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
        padding: "24px",
      }}
    >
      {/* ── Header ── */}
      <div
        style={{
          background: "linear-gradient(135deg, #0F2D1A 0%, #1A7A3C 100%)",
          borderRadius: "18px",
          padding: "28px 32px",
          marginBottom: "28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          boxShadow: "0 8px 32px #0F2D1A55",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                background: "#8DC63F",
                borderRadius: "10px",
                width: "42px",
                height: "42px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "22px",
              }}
            >
              🏭
            </div>
            <div>
              <div style={{ color: "#8DC63F", fontSize: "11px", fontWeight: "600", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                OCP Benguerir — PhosWatch
              </div>
              <div style={{ color: "#fff", fontSize: "20px", fontWeight: "800", marginTop: "2px" }}>
                Role-Based Access Control
              </div>
            </div>
          </div>
        </div>
        <div
          style={{
            background: "rgba(255,255,255,0.1)",
            borderRadius: "10px",
            padding: "10px 18px",
            color: "#D4EDDA",
            fontSize: "12px",
            lineHeight: "1.6",
          }}
        >
          <strong style={{ color: "#8DC63F" }}>4 Roles</strong> · {PERMISSION_MATRIX.length} Capabilities ·{" "}
          <strong style={{ color: "#8DC63F" }}>JWT Secured</strong>
        </div>
      </div>

      {/* ── Role Selector Cards ── */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: "14px",
          marginBottom: "24px",
        }}
      >
        {Object.values(ROLES).map((r) => (
          <RoleCard
            key={r.key}
            role={r}
            isActive={activeRole === r.key}
            onClick={() => setActiveRole(r.key)}
          />
        ))}
      </div>

      {/* ── Tab Switch ── */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "20px",
          background: "#fff",
          padding: "6px",
          borderRadius: "12px",
          width: "fit-content",
          boxShadow: "0 2px 8px #00000012",
        }}
      >
        {[
          { id: "tasks", label: "📋 Capabilities" },
          { id: "matrix", label: "⚡ Permission Matrix" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: "9px 20px",
              borderRadius: "9px",
              border: "none",
              cursor: "pointer",
              fontWeight: "600",
              fontSize: "13px",
              background: activeTab === tab.id ? role.accent : "transparent",
              color: activeTab === tab.id ? "#fff" : "#6B7F6E",
              transition: "all 0.2s ease",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Content ── */}
      {activeTab === "tasks" ? (
        <div>
          {/* Active Role Header */}
          <div
            style={{
              background: `linear-gradient(135deg, ${role.color} 0%, ${role.accent} 100%)`,
              borderRadius: "16px",
              padding: "20px 24px",
              marginBottom: "20px",
              display: "flex",
              alignItems: "center",
              gap: "16px",
              boxShadow: `0 6px 24px ${role.accent}44`,
            }}
          >
            <div style={{ fontSize: "36px" }}>{role.icon}</div>
            <div>
              <div style={{ color: role.badge, fontSize: "11px", fontWeight: "600", letterSpacing: "1px", textTransform: "uppercase" }}>
                Active Role
              </div>
              <div style={{ color: "#fff", fontSize: "22px", fontWeight: "800" }}>{role.label}</div>
              <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "13px", marginTop: "2px" }}>{role.description}</div>
            </div>
          </div>

          {/* Task Sections */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))",
              gap: "14px",
            }}
          >
            {role.tasks.map((section, i) => (
              <TaskSection
                key={i}
                category={section.category}
                icon={section.icon}
                items={section.items}
                accent={role.accent}
              />
            ))}
          </div>
        </div>
      ) : (
        <div
          style={{
            background: "#fff",
            borderRadius: "16px",
            overflow: "hidden",
            boxShadow: "0 4px 20px #00000015",
          }}
        >
          <div style={{ padding: "16px 20px", borderBottom: "1px solid #E8F3EA" }}>
            <div style={{ fontWeight: "700", color: "#0F2D1A", fontSize: "15px" }}>
              ⚡ Full Permission Matrix
            </div>
            <div style={{ fontSize: "12px", color: "#6B7F6E", marginTop: "4px" }}>
              Highlighted column = currently selected role
            </div>
          </div>
          <div style={{ padding: "16px" }}>
            <PermissionMatrix activeRole={activeRole} />
          </div>
        </div>
      )}

      {/* ── Footer ── */}
      <div
        style={{
          marginTop: "28px",
          textAlign: "center",
          color: "#9DB89F",
          fontSize: "11px",
        }}
      >
        PhosWatch RBAC · OCP Benguerir · PFE 2026 · EL BARNATY Othmane
      </div>
    </div>
  );
}
