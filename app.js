"use strict";

/* ===== RUNTIME CONFIG ===== */
const CONFIG_SCRIPT_PATH = "app-config.js";
const PHOTO_BUCKET = "member-photos";
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PROJECT_CATEGORIES = ["web", "mobile", "ai", "cloud", "security", "other"];
const PROJECT_STATUSES = ["Active", "Completed", "Archived"];
const EVENT_TYPES = ["Hackathon", "Competition", "Workshop", "Conference", "Sprint", "Talk", "Other"];
const EVENT_STATUSES = ["upcoming", "ongoing", "past"];
const CONTACT_TOPICS = ["Join ECC", "Collaboration", "Sponsorship", "General Query"];

let supabaseClient = null;
let currentUser = null;
let currentPage = "";
let activeFilter = "all";
let routeToken = 0;
let configNoticeShown = false;
let typedInstance = null;

let DB = {
  members: [],
  projects: [],
  events: [],
  stats: { members_count: 0, projects_count: 0, hackathons_count: 0, awards_count: 0 },
};

/* ===== DOM HELPERS ===== */
function byId(id) {
  return document.getElementById(id);
}

function isElement(value) {
  return value instanceof Element;
}

function appendChildren(parent, children) {
  children.flat(Infinity).forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    if (child instanceof Node) parent.appendChild(child);
    else parent.appendChild(document.createTextNode(String(child)));
  });
  return parent;
}

function el(tag, options = {}, ...children) {
  const node = document.createElement(tag);
  applyOptions(node, options);
  return appendChildren(node, children);
}

function svgEl(tag, options = {}, ...children) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  applyOptions(node, options);
  return appendChildren(node, children);
}

function applyOptions(node, options) {
  if (options.className) {
    node.className = Array.isArray(options.className) ? options.className.filter(Boolean).join(" ") : options.className;
  }

  if (options.text !== undefined) node.textContent = String(options.text);
  if (options.id) node.id = options.id;
  if (options.value !== undefined) node.value = options.value;
  if (options.type) node.type = options.type;
  if (options.placeholder) node.placeholder = options.placeholder;
  if (options.name) node.name = options.name;
  if (options.title) node.title = options.title;
  if (options.alt) node.alt = options.alt;
  if (options.src) node.src = options.src;
  if (options.href) node.href = options.href;
  if (options.target) node.target = options.target;
  if (options.rel) node.rel = options.rel;
  if (options.htmlFor) node.htmlFor = options.htmlFor;
  if (options.accept) node.accept = options.accept;
  if (options.autocomplete) node.autocomplete = options.autocomplete;
  if (options.maxLength !== undefined) node.maxLength = options.maxLength;
  if (options.min !== undefined) node.min = options.min;
  if (options.max !== undefined) node.max = options.max;
  if (options.step !== undefined) node.step = options.step;
  if (options.required) node.required = true;
  if (options.disabled) node.disabled = true;
  if (options.colSpan) node.colSpan = options.colSpan;

  if (options.dataset) {
    Object.entries(options.dataset).forEach(([key, value]) => {
      node.dataset[key] = String(value);
    });
  }

  if (options.style) {
    Object.assign(node.style, options.style);
  }

  if (options.attrs) {
    Object.entries(options.attrs).forEach(([key, value]) => {
      if (value !== null && value !== undefined) node.setAttribute(key, String(value));
    });
  }

  if (options.on) {
    Object.entries(options.on).forEach(([eventName, handler]) => {
      node.addEventListener(eventName, handler);
    });
  }
}

function clearNode(node) {
  if (node) node.replaceChildren();
}

function setText(id, value) {
  const node = byId(id);
  if (node) node.textContent = String(value ?? "");
}

function setInputValue(id, value) {
  const node = byId(id);
  if (node) node.value = value ?? "";
}

function getInputValue(id) {
  return byId(id)?.value ?? "";
}

function setDisplay(node, display) {
  if (node) node.style.display = display;
}

function isCoarsePointer() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function debounce(fn, wait = 150) {
  let timeoutId;
  return (...args) => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => fn(...args), wait);
  };
}

/* ===== VALIDATION HELPERS ===== */
function cleanText(value, { label = "Value", max = 255, required = false, multiline = false } = {}) {
  let text = String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
  text = multiline ? text.replace(/\r\n?/g, "\n").trim() : text.replace(/\s+/g, " ").trim();

  if (required && !text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function validateEmail(value, label = "Email") {
  const email = cleanText(value, { label, max: 150, required: true });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`${label} must be a valid email address`);
  return email;
}

function optionalHttpUrl(value, label) {
  const raw = cleanText(value, { label, max: 300 });
  if (!raw || raw === "#") return "#";
  if (!/^https?:\/\//i.test(raw)) throw new Error(`${label} must start with http:// or https://`);

  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
    return parsed.href;
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
}

function safeHttpUrl(value) {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "#") return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function boundedInteger(value, { label, min = 0, max = 100000 } = {}) {
  const num = Number.parseInt(value, 10);
  if (Number.isNaN(num)) return min;
  if (num < min || num > max) throw new Error(`${label} must be between ${min} and ${max}`);
  return num;
}

function enumValue(value, allowed, label) {
  if (!allowed.includes(value)) throw new Error(`${label} is invalid`);
  return value;
}

function dateValue(value, label = "Date") {
  const raw = cleanText(value, { label, max: 20, required: true });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime())) {
    throw new Error(`${label} must be a valid date`);
  }
  return raw;
}

function splitCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function initialsForName(name) {
  return cleanText(name, { max: 80 })
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function safeStatusClass(status) {
  return EVENT_STATUSES.includes(status) ? status : "past";
}

function validatePhotoFile(file) {
  if (!file) throw new Error("Please select a photo");
  if (!ALLOWED_PHOTO_TYPES.has(file.type)) throw new Error("Photo must be a JPG, PNG, or WEBP image");
  if (file.size > MAX_PHOTO_BYTES) throw new Error("Photo must be under 2MB");
}

/* ===== SUPABASE CONFIG & DATA ===== */
function readRuntimeConfig() {
  const config = window.ECC_SUPABASE_CONFIG || {};
  return {
    url: cleanText(config.url || config.supabaseUrl || "", { label: "Supabase URL", max: 200 }),
    key: cleanText(config.publishableKey || config.anonKey || config.supabaseKey || "", {
      label: "Supabase publishable key",
      max: 2000,
    }),
  };
}

function loadOptionalConfigScript() {
  if (window.ECC_SUPABASE_CONFIG) return Promise.resolve();

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = CONFIG_SCRIPT_PATH;
    script.async = false;
    script.onload = () => resolve();
    script.onerror = () => resolve();
    document.head.appendChild(script);
  });
}

async function initSupabaseClient() {
  await loadOptionalConfigScript();

  try {
    const config = readRuntimeConfig();
    if (!config.url || !config.key) {
      console.warn(`Supabase is not configured. Create ${CONFIG_SCRIPT_PATH} from app-config.example.js.`);
      return;
    }

    const parsedUrl = new URL(config.url);
    if (parsedUrl.protocol !== "https:") throw new Error("Supabase URL must use HTTPS");
    if (!window.supabase?.createClient) throw new Error("Supabase SDK failed to load");

    supabaseClient = window.supabase.createClient(config.url, config.key, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setAuthState(session?.user || null);
    });
  } catch (error) {
    console.error("Supabase configuration failed:", error);
    showToast(error.message || "Supabase configuration failed", "error");
  }
}

function requireSupabase() {
  if (!supabaseClient) throw new Error(`Supabase is not configured. Create ${CONFIG_SCRIPT_PATH} first.`);
  return supabaseClient;
}

function requireAdminSession() {
  requireSupabase();
  if (!currentUser) throw new Error("Please sign in again before making changes");
}

function showConfigNotice() {
  if (supabaseClient || configNoticeShown) return;
  configNoticeShown = true;
  showToast(`Supabase is not configured. Create ${CONFIG_SCRIPT_PATH} to enable live data.`, "info");
}

function setAuthState(user) {
  currentUser = user;
  setText("admin-user-email", currentUser ? currentUser.email : "admin");
  if (!currentUser) closeAdminPanel();
}

async function checkSession() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    setAuthState(data.session?.user || null);
  } catch (error) {
    console.error("Session check failed:", error);
    setAuthState(null);
  }
}

async function loadDB() {
  if (!supabaseClient) {
    updateDashboardStats();
    updatePublicStats();
    return;
  }

  try {
    const [membersRes, projectsRes, eventsRes, statsRes] = await Promise.all([
      supabaseClient.from("members").select("*").order("created_at", { ascending: true }),
      supabaseClient.from("projects").select("*").order("created_at", { ascending: true }),
      supabaseClient.from("events").select("*").order("date", { ascending: false }),
      supabaseClient.from("stats").select("*").limit(1),
    ]);

    [membersRes, projectsRes, eventsRes, statsRes].forEach((result) => {
      if (result.error) throw result.error;
    });

    DB.members = membersRes.data || [];
    DB.projects = projectsRes.data || [];
    DB.events = eventsRes.data || [];
    DB.stats = statsRes.data?.[0] || DB.stats;

    updateDashboardStats();
    updatePublicStats();
  } catch (error) {
    console.error("Error loading database:", error);
    showToast("Failed to load data from Supabase", "error");
  }
}

/* ===== AUTHENTICATION ===== */
async function doLogin() {
  const loginButton = document.querySelector("#admin-modal .btn-primary");
  try {
    const client = requireSupabase();
    const email = validateEmail(getInputValue("admin-email"), "Admin email");
    const password = getInputValue("admin-pass");
    if (!password) throw new Error("Password is required");

    if (loginButton) {
      loginButton.disabled = true;
      loginButton.textContent = "SIGNING IN...";
    }

    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    setAuthState(data.user);
    closeAdminModal();
    openAdminPanel();
  } catch (error) {
    showLoginError(error.message || "Login failed");
  } finally {
    if (loginButton) {
      loginButton.disabled = false;
      loginButton.textContent = "ACCESS PANEL ->";
    }
  }
}

async function doLogout() {
  try {
    if (supabaseClient) await supabaseClient.auth.signOut();
  } finally {
    setAuthState(null);
    closeAdminPanel();
    showToast("Logged out successfully", "info");
  }
}

function showLoginError(message) {
  const errorBox = byId("login-error");
  if (!errorBox) return;
  errorBox.textContent = message;
  errorBox.style.display = "block";
  window.setTimeout(() => {
    errorBox.style.display = "none";
  }, 4000);
}

/* ===== ROUTING ===== */
const pages = ["home", "about", "team", "projects", "events", "contact"];

function getRoutePage() {
  const hash = window.location.hash.slice(1);
  return pages.includes(hash) ? hash : "home";
}

function handleRoute() {
  const nextPage = getRoutePage();
  if (currentPage === nextPage) return;

  const token = ++routeToken;
  const oldPage = currentPage ? byId(`page-${currentPage}`) : null;

  if (oldPage && window.gsap) {
    window.gsap.to(oldPage, {
      opacity: 0,
      y: -12,
      duration: 0.22,
      ease: "power1.out",
      onComplete: () => {
        if (token === routeToken) activatePage(nextPage);
      },
    });
  } else {
    activatePage(nextPage);
  }
}

function activatePage(page) {
  document.querySelectorAll(".page").forEach((pageNode) => {
    pageNode.classList.remove("active");
    pageNode.style.opacity = "0";
    pageNode.style.transform = "";
  });

  const nextNode = byId(`page-${page}`);
  if (!nextNode) return;

  nextNode.classList.add("active");
  document.body.dataset.page = page;

  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.classList.toggle("active", link.dataset.page === page);
  });

  const footer = byId("footer");
  if (footer) footer.style.display = page === "home" ? "none" : "block";

  currentPage = page;
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderCurrentPage(page);

  if (window.gsap) {
    window.gsap.fromTo(
      nextNode,
      { opacity: 0, y: 16 },
      { opacity: 1, y: 0, duration: 0.32, ease: "power2.out", clearProps: "transform" },
    );
    window.gsap.fromTo(
      nextNode.querySelectorAll(".section-header, .reveal, .team-card, .project-card, .timeline-item"),
      { y: 24, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.55, stagger: 0.06, ease: "power2.out", clearProps: "all" },
    );
  } else {
    window.requestAnimationFrame(() => {
      nextNode.style.opacity = "1";
    });
  }
}

function renderCurrentPage(page) {
  initReveal();
  if (page === "team") renderTeam();
  if (page === "projects") renderProjects();
  if (page === "events") renderEvents();
  if (page === "home" || page === "about") animateCounters();
}

function navigateTo(page) {
  if (pages.includes(page)) window.location.hash = page;
}

/* ===== ANIMATION LOOP ===== */
let isTabVisible = !document.hidden;
let animationLoopStarted = false;
const animationCallbacks = new Set();

document.addEventListener("visibilitychange", () => {
  isTabVisible = !document.hidden;
});

function addAnimationCallback(callback) {
  animationCallbacks.add(callback);
  if (!animationLoopStarted) {
    animationLoopStarted = true;
    window.requestAnimationFrame(runAnimationLoop);
  }
  return () => animationCallbacks.delete(callback);
}

function runAnimationLoop(time) {
  window.requestAnimationFrame(runAnimationLoop);
  if (!isTabVisible) return;

  animationCallbacks.forEach((callback) => {
    try {
      callback(time);
    } catch (error) {
      console.error("Animation callback failed:", error);
      animationCallbacks.delete(callback);
    }
  });
}

function initThreeBackground() {
  if (typeof THREE === "undefined") return;

  const canvas = byId("bg-canvas");
  if (!canvas) return;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 5;

  const count = 1200;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);

  for (let i = 0; i < count * 3; i += 3) {
    positions[i] = (Math.random() - 0.5) * 20;
    positions[i + 1] = (Math.random() - 0.5) * 20;
    positions[i + 2] = (Math.random() - 0.5) * 20;

    const purple = Math.random() < 0.5;
    colors[i] = purple ? 0.48 : 0.0;
    colors[i + 1] = purple ? 0.18 : 0.83;
    colors[i + 2] = 1.0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.PointsMaterial({
    size: 0.05,
    vertexColors: true,
    transparent: true,
    opacity: 0.6,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  let mouseX = 0;
  let mouseY = 0;
  let frame = 0;
  const positionArray = geometry.attributes.position.array;

  document.addEventListener(
    "mousemove",
    (event) => {
      if (!isTabVisible) return;
      mouseX = (event.clientX / window.innerWidth - 0.5) * 2;
      mouseY = -(event.clientY / window.innerHeight - 0.5) * 2;
    },
    { passive: true },
  );

  window.addEventListener(
    "resize",
    debounce(() => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, 200),
  );

  addAnimationCallback(() => {
    frame += 1;
    particles.rotation.x += 0.0005 + mouseY * 0.0002;
    particles.rotation.y += 0.0008 + mouseX * 0.0002;

    for (let i = 1; i < positionArray.length; i += 3) {
      positionArray[i] += Math.sin(frame * 0.005 + positionArray[i - 1]) * 0.0005;
    }

    geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
  });
}

function initCursor() {
  if (isCoarsePointer()) return;

  const cursor = byId("cursor");
  const ring = byId("cursor-ring");
  const trailContainer = byId("cursor-trail-container");
  if (!cursor || !ring || !trailContainer) return;

  clearNode(trailContainer);

  const trails = [];
  const trailCount = 6;
  for (let i = 0; i < trailCount; i += 1) {
    const dot = el("div", { className: "trail-dot" });
    const size = (trailCount - i) * 2;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.background = `rgba(${i < trailCount / 2 ? "123,47,255" : "0,212,255"},${0.4 - i * 0.05})`;
    trailContainer.appendChild(dot);
    trails.push({ el: dot, x: 0, y: 0 });
  }

  let mouseX = 0;
  let mouseY = 0;

  document.addEventListener(
    "mousemove",
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      cursor.style.left = `${mouseX}px`;
      cursor.style.top = `${mouseY}px`;
      ring.style.left = `${mouseX}px`;
      ring.style.top = `${mouseY}px`;
    },
    { passive: true },
  );

  document.addEventListener("mousedown", () => {
    cursor.style.transform = "translate(-50%,-50%) scale(0.7)";
    ring.style.transform = "translate(-50%,-50%) scale(1.3)";
  });

  document.addEventListener("mouseup", () => {
    cursor.style.transform = "translate(-50%,-50%) scale(1)";
    ring.style.transform = "translate(-50%,-50%) scale(1)";
  });

  document.addEventListener("mouseover", (event) => {
    if (!isElement(event.target) || !event.target.closest("button,a,[onclick],input,select,textarea,.photo-upload-zone")) return;
    cursor.style.transform = "translate(-50%,-50%) scale(1.5)";
    cursor.style.background = "var(--purple-light)";
    ring.style.transform = "translate(-50%,-50%) scale(0.7)";
    ring.style.borderColor = "rgba(123,47,255,0.9)";
  });

  document.addEventListener("mouseout", (event) => {
    if (!isElement(event.target) || !event.target.closest("button,a,[onclick],input,select,textarea,.photo-upload-zone")) return;
    cursor.style.transform = "translate(-50%,-50%) scale(1)";
    cursor.style.background = "var(--blue)";
    ring.style.transform = "translate(-50%,-50%) scale(1)";
    ring.style.borderColor = "rgba(123,47,255,0.7)";
  });

  addAnimationCallback(() => {
    let previousX = mouseX;
    let previousY = mouseY;

    trails.forEach((trail) => {
      trail.x += (previousX - trail.x) * 0.3;
      trail.y += (previousY - trail.y) * 0.3;
      trail.el.style.left = `${trail.x}px`;
      trail.el.style.top = `${trail.y}px`;
      previousX = trail.x;
      previousY = trail.y;
    });
  });
}

function initTyped() {
  if (typedInstance || !byId("typed-el") || typeof Typed === "undefined") return;
  typedInstance = new Typed("#typed-el", {
    strings: [
      "We write code that matters.",
      "We build solutions that scale.",
      "We hack through the night.",
      "We think, design, develop, deploy.",
      "We are Elite Coding Club.",
    ],
    typeSpeed: 50,
    backSpeed: 30,
    loop: true,
    backDelay: 2000,
    startDelay: 500,
  });
}

/* ===== GENERAL UI ===== */
let revealObserver = null;

function initReveal() {
  if (!("IntersectionObserver" in window)) {
    document.querySelectorAll(".reveal").forEach((node) => node.classList.add("visible"));
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1 },
    );
  }

  document.querySelectorAll(".reveal:not(.visible)").forEach((node) => revealObserver.observe(node));
}

function animateCounters() {
  document.querySelectorAll(".stat-num[data-target], .stats-num[data-target]").forEach((node) => {
    const target = Number.parseInt(node.dataset.target, 10) || 0;
    if (node.dataset.counterDone === String(target)) return;

    node.dataset.counterDone = String(target);
    const duration = 1200;
    const startTime = performance.now();

    function step(now) {
      const progress = Math.min((now - startTime) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      node.textContent = `${Math.floor(target * eased)}${target >= 10 ? "+" : ""}`;
      if (progress < 1) window.requestAnimationFrame(step);
    }

    window.requestAnimationFrame(step);
  });
}

function toggleMobileMenu() {
  const menu = byId("mobile-menu");
  if (!menu) return;
  menu.style.display = menu.style.display === "none" || !menu.style.display ? "flex" : "none";
}

function closeMobileMenu() {
  setDisplay(byId("mobile-menu"), "none");
}

function showToast(message, type = "info") {
  const container = byId("toast-container");
  if (!container) return;

  const icons = { success: "OK", error: "X", info: "i" };
  const toast = el(
    "div",
    { className: `toast ${type}` },
    el("span", { text: icons[type] || icons.info }),
    el("span", { text: cleanText(message, { max: 240 }) }),
  );

  container.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3100);
}

function formatDate(value) {
  if (!value) return "TBA";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "TBA";
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function initHexGrid() {
  const container = byId("hex-grid-bg");
  if (!container) return;
  clearNode(container);

  const pattern = svgEl(
    "pattern",
    { attrs: { id: "hexPattern", x: "0", y: "0", width: "50", height: "57.7", patternUnits: "userSpaceOnUse" } },
    svgEl("polygon", {
      attrs: {
        points: "25,0 50,14.4 50,43.3 25,57.7 0,43.3 0,14.4",
        fill: "none",
        stroke: "rgba(123,47,255,0.15)",
        "stroke-width": "0.5",
      },
    }),
  );

  container.appendChild(
    svgEl(
      "svg",
      { attrs: { width: "100%", height: "100%" } },
      svgEl("defs", {}, pattern),
      svgEl("rect", { attrs: { width: "100%", height: "100%", fill: "url(#hexPattern)" } }),
    ),
  );
}

function initGSAP() {
  if (typeof gsap === "undefined" || typeof ScrollTrigger === "undefined") return;
  gsap.registerPlugin(ScrollTrigger);

  gsap.utils.toArray(".pillar-card").forEach((card, index) => {
    gsap.from(card, {
      scrollTrigger: { trigger: card, start: "top 85%" },
      y: 42,
      opacity: 0,
      duration: 0.55,
      delay: index * 0.08,
      ease: "power2.out",
    });
  });
}

function initMagneticButtons() {
  if (isCoarsePointer()) return;

  document.querySelectorAll(".btn-primary, .btn-secondary, .nav-admin-btn").forEach((button) => {
    if (button.dataset.magneticReady) return;
    button.dataset.magneticReady = "true";

    button.addEventListener("mousemove", (event) => {
      const rect = button.getBoundingClientRect();
      const x = event.clientX - rect.left - rect.width / 2;
      const y = event.clientY - rect.top - rect.height / 2;
      button.style.transform = `translate(${x * 0.2}px, ${y * 0.3}px)`;
    });

    button.addEventListener("mouseleave", () => {
      button.style.transform = "";
    });
  });
}

function hideLoading() {
  window.setTimeout(() => {
    const loading = byId("loading");
    if (!loading) return;
    loading.classList.add("hidden");
    initTyped();
    window.setTimeout(() => {
      animateCounters();
      initReveal();
      loading.style.display = "none";
    }, 300);
  }, 1200);
}

function initTilt(selector, options) {
  if (isCoarsePointer() || typeof VanillaTilt === "undefined") return;
  const nodes = Array.from(document.querySelectorAll(selector));
  nodes.forEach((node) => {
    if (node.vanillaTilt) node.vanillaTilt.destroy();
  });
  if (nodes.length) VanillaTilt.init(nodes, options);
}

/* ===== RENDER HELPERS ===== */
function emptyState(icon, title, body, extraStyle = {}) {
  return el(
    "div",
    { className: "empty-state", style: extraStyle },
    el("div", { className: "empty-state-icon", text: icon }),
    el("h3", { text: title }),
    el("p", { text: body }),
  );
}

function skillTags(value) {
  return splitCsv(value).map((skill) => el("span", { className: "skill-tag", text: skill }));
}

function smallAvatar(member) {
  const wrapper = el("div", {
    style: {
      width: "30px",
      height: "30px",
      borderRadius: "50%",
      background: "var(--purple)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "10px",
      fontWeight: "bold",
      color: "white",
      overflow: "hidden",
      flexShrink: "0",
    },
  });

  const photoUrl = safeHttpUrl(member.photo_url);
  if (photoUrl) {
    wrapper.appendChild(
      el("img", {
        src: photoUrl,
        alt: cleanText(member.name, { max: 80 }),
        style: { width: "100%", height: "100%", objectFit: "cover" },
      }),
    );
  } else {
    wrapper.textContent = member.initials || initialsForName(member.name || "");
  }
  return wrapper;
}

function tableActions(...buttons) {
  return el("div", { className: "table-actions" }, buttons);
}

function actionButton(label, className, handler) {
  return el("button", { className, text: label, type: "button", on: { click: handler } });
}

function emptyTableRow(colSpan, text) {
  return el(
    "tr",
    {},
    el("td", {
      colSpan,
      text,
      style: { textAlign: "center", color: "rgba(200,200,220,0.3)", padding: "2rem" },
    }),
  );
}

/* ===== PUBLIC RENDERING ===== */
function renderTeam() {
  const grid = byId("team-grid");
  if (!grid) return;
  clearNode(grid);

  if (!DB.members.length) {
    grid.appendChild(emptyState("TEAM", "No members yet", "Admin can add team members via the admin panel."));
    return;
  }

  const fragment = document.createDocumentFragment();
  DB.members.forEach((member) => {
    const card = el("div", { className: "team-card", attrs: { "data-tilt": "", "data-tilt-max": "8" } });
    const avatar = el("div", { className: "team-avatar" });
    const photoUrl = safeHttpUrl(member.photo_url);

    if (photoUrl) {
      avatar.appendChild(el("img", { src: photoUrl, alt: cleanText(member.name, { max: 80 }), attrs: { loading: "lazy" } }));
    } else {
      avatar.textContent = member.initials || initialsForName(member.name || "");
    }

    const socialLinks = el("div", { className: "team-social" });
    const github = safeHttpUrl(member.github);
    const linkedin = safeHttpUrl(member.linkedin);
    if (github) socialLinks.appendChild(el("a", { className: "social-link", href: github, target: "_blank", rel: "noopener", text: "GH" }));
    if (linkedin) socialLinks.appendChild(el("a", { className: "social-link", href: linkedin, target: "_blank", rel: "noopener", text: "LI" }));

    card.append(
      el(
        "div",
        { className: "team-card-header" },
        avatar,
        el("div", { className: "team-name", text: member.name || "Unnamed Member" }),
        el("div", { className: "team-role", text: member.role || "Member" }),
      ),
      el(
        "div",
        { className: "team-card-body" },
        el("div", { className: "team-bio", text: member.bio || "A passionate member of Elite Coding Club." }),
        el("div", { className: "team-skills" }, skillTags(member.skills)),
        el("div", {
          text: member.year || "",
          style: {
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: "rgba(200,200,220,0.3)",
            letterSpacing: "2px",
            marginBottom: "0.75rem",
          },
        }),
        socialLinks,
      ),
    );
    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
  initTilt(".team-card", { max: 8, speed: 400, glare: true, "max-glare": 0.1 });
}

function renderProjects(filter) {
  const grid = byId("projects-grid");
  if (!grid) return;
  clearNode(grid);

  if (filter) activeFilter = filter;
  const filtered = activeFilter === "all" ? DB.projects : DB.projects.filter((project) => project.category === activeFilter);

  if (!filtered.length) {
    grid.appendChild(emptyState("WORK", "No projects found", "Admin can add projects via the admin panel."));
    return;
  }

  const fragment = document.createDocumentFragment();
  filtered.forEach((project) => {
    const statusColor =
      project.status === "Active" ? "#00ff88" : project.status === "Completed" ? "var(--blue)" : "rgba(200,200,220,0.3)";
    const github = safeHttpUrl(project.github_url);
    const demo = safeHttpUrl(project.demo_url);

    const links = el("div", { className: "project-links" });
    links.appendChild(
      github
        ? el("a", { className: "project-link primary", href: github, target: "_blank", rel: "noopener", text: "GITHUB" })
        : el("span", { className: "project-link primary", text: "GITHUB", style: { opacity: "0.5" } }),
    );
    if (demo) links.appendChild(el("a", { className: "project-link secondary", href: demo, target: "_blank", rel: "noopener", text: "LIVE DEMO" }));

    const card = el(
      "div",
      { className: "project-card", attrs: { "data-tilt": "", "data-tilt-max": "5" } },
      el(
        "div",
        { className: "project-thumb" },
        el("span", { className: "project-thumb-icon", text: project.icon || "CODE" }),
        el("div", { className: "project-thumb-overlay" }),
        el("div", { className: "project-tag-overlay", text: String(project.category || "other").toUpperCase() }),
      ),
      el(
        "div",
        { className: "project-body" },
        el("div", { className: "project-title", text: project.title || "Untitled Project" }),
        el("div", { className: "project-desc", text: project.desc || "" }),
        el("div", { className: "project-tech" }, skillTags(project.tech)),
        el("div", {
          text: `* ${project.status || "Archived"}`,
          style: {
            fontFamily: "var(--font-mono)",
            fontSize: "0.65rem",
            color: statusColor,
            letterSpacing: "2px",
            marginBottom: "1rem",
          },
        }),
        links,
      ),
    );

    fragment.appendChild(card);
  });

  grid.appendChild(fragment);
  initTilt(".project-card", { max: 5, speed: 400 });
}

function renderEvents() {
  const timeline = byId("events-timeline");
  if (!timeline) return;
  clearNode(timeline);

  if (!DB.events.length) {
    timeline.appendChild(emptyState("DATE", "No events yet", "Admin can add events.", { marginLeft: "-4rem" }));
    return;
  }

  const fragment = document.createDocumentFragment();
  DB.events.forEach((eventItem) => {
    const status = safeStatusClass(eventItem.status);
    fragment.appendChild(
      el(
        "div",
        { className: "timeline-item" },
        el("div", { className: "timeline-dot" }),
        el(
          "div",
          { className: "event-card" },
          el(
            "div",
            { className: "event-header" },
            el("div", { className: "event-title", text: eventItem.title || "Untitled Event" }),
            el("div", { className: "event-date", text: formatDate(eventItem.date) }),
          ),
          el("div", { className: "event-desc", text: eventItem.desc || "" }),
          el(
            "div",
            { className: "event-meta" },
            el("span", { className: "event-meta-item", text: `Venue: ${eventItem.venue || "TBA"}` }),
            el("span", { className: "event-meta-item", text: `${eventItem.participants || 0} participants` }),
            el("span", { className: "event-meta-item", text: eventItem.type || "Event" }),
          ),
          el("span", { className: `event-status status-${status}`, text: status.toUpperCase() }),
        ),
      ),
    );
  });

  timeline.appendChild(fragment);
}

function updatePublicStats() {
  const stats = DB.stats || {};
  const pairs = [
    ["hero-stat-members", stats.members_count || 0],
    ["hero-stat-projects", stats.projects_count || 0],
    ["hero-stat-hackathons", stats.hackathons_count || 0],
    ["hero-stat-awards", stats.awards_count || 0],
    ["about-stat-members", stats.members_count || 0],
    ["about-stat-projects", stats.projects_count || 0],
    ["about-stat-hackathons", stats.hackathons_count || 0],
    ["about-stat-awards", stats.awards_count || 0],
  ];

  pairs.forEach(([id, value]) => {
    const node = byId(id);
    if (!node) return;
    node.dataset.target = String(value);
    delete node.dataset.counterDone;
  });
}

/* ===== CONTACT FORM ===== */
async function submitContactForm(event) {
  if (event) event.preventDefault();
  const button = byId("cf-submit-btn");

  try {
    const client = requireSupabase();
    const payload = {
      name: cleanText(getInputValue("cf-name"), { label: "Name", max: 80, required: true }),
      email: validateEmail(getInputValue("cf-email")),
      topic: enumValue(getInputValue("cf-topic"), CONTACT_TOPICS, "Topic"),
      message: cleanText(getInputValue("cf-message"), { label: "Message", max: 1000, required: true, multiline: true }),
    };

    if (button) {
      button.disabled = true;
      button.textContent = "SENDING...";
    }

    const { error } = await client.from("contact_messages").insert([payload]);
    if (error) throw error;

    showToast("Message sent. We will get back to you soon.", "success");
    byId("contact-form")?.reset();
  } catch (error) {
    console.error("Contact form error:", error);
    showToast(error.message || "Failed to send message", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "SEND MESSAGE ->";
    }
  }
}

/* ===== ADMIN PANEL UI ===== */
function openAdminModal() {
  if (currentUser) {
    openAdminPanel();
    return;
  }

  const modal = byId("admin-modal");
  if (!modal) return;
  modal.classList.add("open");
  if (!supabaseClient) showLoginError(`Supabase is not configured. Create ${CONFIG_SCRIPT_PATH} first.`);
}

function closeAdminModal() {
  const modal = byId("admin-modal");
  if (modal) modal.classList.remove("open");
  const loginError = byId("login-error");
  if (loginError) loginError.style.display = "none";
  setInputValue("admin-email", "");
  setInputValue("admin-pass", "");
}

function openAdminPanel() {
  const panel = byId("admin-panel");
  if (!panel) return;
  panel.classList.add("open");
  updateDashboardStats();
  renderAdminTeam();
  renderAdminProjects();
  renderAdminEvents();
  loadStatsForm();
}

function closeAdminPanel() {
  byId("admin-panel")?.classList.remove("open");
}

function switchAdminSection(id, trigger) {
  document.querySelectorAll(".admin-section").forEach((section) => section.classList.remove("active"));
  document.querySelectorAll(".admin-nav-item").forEach((item) => item.classList.remove("active"));
  byId(`admin-sec-${id}`)?.classList.add("active");
  if (trigger) trigger.classList.add("active");
}

function updateDashboardStats() {
  setText("dash-members", DB.members.length);
  setText("dash-projects", DB.projects.length);
  setText("dash-events", DB.events.length);
  setText("dash-upcoming", DB.events.filter((eventItem) => eventItem.status === "upcoming").length);
}

/* ===== ADMIN FORM HELPERS ===== */
let formMode = "";
let formType = "";
let editId = null;
let uploadedPhotoFile = null;

function formGroup(label, control) {
  return el("div", { className: "form-group" }, el("label", { className: "form-label", text: label }), control);
}

function formRow(...groups) {
  return el("div", { className: "form-row" }, groups);
}

function textInput(id, value, placeholder, options = {}) {
  return el("input", {
    className: "form-input",
    id,
    type: options.type || "text",
    value: value ?? "",
    placeholder,
    maxLength: options.maxLength,
    min: options.min,
    max: options.max,
    step: options.step,
  });
}

function textareaInput(id, value, placeholder, maxLength) {
  return el("textarea", {
    className: "form-textarea",
    id,
    value: value ?? "",
    placeholder,
    maxLength,
  });
}

function selectInput(id, options, selected) {
  return el(
    "select",
    { className: "form-select", id },
    options.map((option) => {
      const value = typeof option === "string" ? option : option.value;
      const label = typeof option === "string" ? option : option.label;
      return el("option", { value, text: label, attrs: value === selected ? { selected: "selected" } : {} });
    }),
  );
}

function openFormModal(title, contentNode) {
  setText("form-modal-title-text", title);
  const body = byId("form-modal-body");
  clearNode(body);
  if (body) body.appendChild(contentNode);
  byId("form-modal")?.classList.add("open");
  uploadedPhotoFile = null;
  initPhotoUpload();
}

function closeFormModal() {
  byId("form-modal")?.classList.remove("open");
  formMode = "";
  formType = "";
  editId = null;
  uploadedPhotoFile = null;
}

function initPhotoUpload() {
  const fileInput = byId("photo-upload-input");
  const zone = byId("photo-dropzone");
  if (!fileInput || !zone) return;

  zone.addEventListener("click", () => fileInput.click());
  zone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      fileInput.click();
    }
  });

  zone.addEventListener("dragover", (event) => {
    event.preventDefault();
    zone.classList.add("dragover");
  });

  zone.addEventListener("dragleave", (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
  });

  zone.addEventListener("drop", (event) => {
    event.preventDefault();
    zone.classList.remove("dragover");
    if (event.dataTransfer.files.length) handlePhotoSelect(event.dataTransfer.files[0]);
  });

  fileInput.addEventListener("change", (event) => {
    if (event.target.files.length) handlePhotoSelect(event.target.files[0]);
  });
}

function handlePhotoSelect(file) {
  try {
    validatePhotoFile(file);
    uploadedPhotoFile = file;

    const reader = new FileReader();
    reader.onload = (event) => {
      setDisplay(byId("photo-dropzone"), "none");
      setDisplay(byId("photo-preview-container"), "flex");
      const preview = byId("photo-preview-img");
      if (preview) preview.src = event.target.result;
    };
    reader.readAsDataURL(file);
  } catch (error) {
    showToast(error.message, "error");
  }
}

function removePhoto() {
  uploadedPhotoFile = null;
  setInputValue("photo-upload-input", "");
  setInputValue("mf-photo-url", "");
  setDisplay(byId("photo-dropzone"), "block");
  setDisplay(byId("photo-preview-container"), "none");
  byId("photo-preview-img")?.removeAttribute("src");
}

async function uploadPhotoToSupabase(file) {
  validatePhotoFile(file);
  requireAdminSession();

  const extensionByType = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };
  const extension = extensionByType[file.type];
  const randomPart = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const owner = currentUser?.id || "admin";
  const filePath = `${owner}/${randomPart}.${extension}`;

  const { error } = await supabaseClient.storage.from(PHOTO_BUCKET).upload(filePath, file, {
    cacheControl: "3600",
    contentType: file.type,
    upsert: false,
  });
  if (error) throw error;

  const { data } = supabaseClient.storage.from(PHOTO_BUCKET).getPublicUrl(filePath);
  return data.publicUrl;
}

/* ===== MEMBER ADMIN ===== */
function memberForm(member = {}) {
  const photoUrl = safeHttpUrl(member.photo_url);
  const dropzoneDisplay = photoUrl ? "none" : "block";
  const previewDisplay = photoUrl ? "flex" : "none";

  const photoGroup = formGroup(
    "// PROFILE PHOTO",
    el(
      "div",
      {},
      el("input", {
        id: "photo-upload-input",
        type: "file",
        accept: "image/png, image/jpeg, image/webp",
        style: { display: "none" },
      }),
      el("input", { id: "mf-photo-url", type: "hidden", value: photoUrl }),
      el(
        "div",
        {
          id: "photo-dropzone",
          className: "photo-upload-zone",
          style: { display: dropzoneDisplay },
          attrs: { role: "button", tabindex: "0" },
        },
        el("div", { text: "Upload Photo", style: { fontFamily: "var(--font-mono)", fontSize: "0.9rem", color: "var(--chrome-light)" } }),
        el("div", { text: "Drag and drop or click to browse", style: { fontSize: "0.8rem", color: "rgba(200,200,220,0.6)", marginTop: "0.5rem" } }),
        el("div", { text: "Max 2MB, JPG, PNG, or WEBP", style: { fontSize: "0.7rem", color: "rgba(200,200,220,0.45)", marginTop: "0.5rem" } }),
      ),
      el(
        "div",
        { id: "photo-preview-container", className: "photo-preview-container", style: { display: previewDisplay } },
        el("img", { id: "photo-preview-img", className: "photo-preview", src: photoUrl, alt: "Preview" }),
        el("button", { type: "button", className: "photo-remove-btn", text: "Remove Photo", on: { click: removePhoto } }),
      ),
    ),
  );

  return el(
    "div",
    {},
    photoGroup,
    formRow(
      formGroup("// FULL NAME", textInput("mf-name", member.name || "", "John Doe", { maxLength: 80 })),
      formGroup("// ROLE", textInput("mf-role", member.role || "", "Lead Developer", { maxLength: 80 })),
    ),
    formGroup("// BIO", textareaInput("mf-bio", member.bio || "", "Short bio...", 500)),
    formRow(
      formGroup("// SKILLS (comma separated)", textInput("mf-skills", member.skills || "", "React, Python, AWS", { maxLength: 250 })),
      formGroup("// YEAR", textInput("mf-year", member.year || "", "3rd Year", { maxLength: 40 })),
    ),
    formRow(
      formGroup("// GITHUB URL", textInput("mf-github", member.github || "#", "https://github.com/...", { maxLength: 300 })),
      formGroup("// LINKEDIN URL", textInput("mf-linkedin", member.linkedin || "#", "https://linkedin.com/in/...", { maxLength: 300 })),
    ),
  );
}

function openMemberForm(id) {
  formType = "member";
  if (id !== undefined && id !== null) {
    const member = DB.members.find((item) => String(item.id) === String(id));
    if (!member) {
      showToast("Member not found", "error");
      return;
    }
    formMode = "edit";
    editId = member.id;
    openFormModal("EDIT MEMBER", memberForm(member));
    return;
  }

  formMode = "add";
  editId = null;
  openFormModal("ADD MEMBER", memberForm());
}

async function saveMemberData() {
  const button = byId("form-save-btn");

  try {
    requireAdminSession();
    if (button) {
      button.disabled = true;
      button.textContent = "SAVING...";
    }

    const member = {
      name: cleanText(getInputValue("mf-name"), { label: "Name", max: 80, required: true }),
      role: cleanText(getInputValue("mf-role"), { label: "Role", max: 80, required: true }),
      bio: cleanText(getInputValue("mf-bio"), { label: "Bio", max: 500, multiline: true }),
      skills: cleanText(getInputValue("mf-skills"), { label: "Skills", max: 250 }),
      year: cleanText(getInputValue("mf-year"), { label: "Year", max: 40 }),
      github: optionalHttpUrl(getInputValue("mf-github"), "GitHub URL"),
      linkedin: optionalHttpUrl(getInputValue("mf-linkedin"), "LinkedIn URL"),
      photo_url: safeHttpUrl(getInputValue("mf-photo-url")),
    };
    member.initials = initialsForName(member.name);

    if (uploadedPhotoFile) member.photo_url = await uploadPhotoToSupabase(uploadedPhotoFile);

    if (formMode === "add") {
      const { data, error } = await supabaseClient.from("members").insert([member]).select();
      if (error) throw error;
      DB.members.push(data[0]);
      showToast("Member added successfully", "success");
    } else {
      const { data, error } = await supabaseClient.from("members").update(member).eq("id", editId).select();
      if (error) throw error;
      const index = DB.members.findIndex((item) => String(item.id) === String(editId));
      if (index >= 0) DB.members[index] = data[0];
      showToast("Member updated", "success");
    }

    closeFormModal();
    renderAdminTeam();
    renderTeam();
    updateDashboardStats();
  } catch (error) {
    console.error("Save member error:", error);
    showToast(error.message || "Failed to save member", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "SAVE";
    }
  }
}

async function deleteMember(id) {
  if (!window.confirm("Delete this member?")) return;
  try {
    requireAdminSession();
    const { error } = await supabaseClient.from("members").delete().eq("id", id);
    if (error) throw error;

    DB.members = DB.members.filter((member) => String(member.id) !== String(id));
    renderAdminTeam();
    renderTeam();
    updateDashboardStats();
    showToast("Member deleted", "info");
  } catch (error) {
    showToast(error.message || "Failed to delete member", "error");
  }
}

function renderAdminTeam() {
  const tbody = byId("team-table-body");
  if (!tbody) return;
  clearNode(tbody);

  if (!DB.members.length) {
    tbody.appendChild(emptyTableRow(5, "No members yet. Add your first member."));
    return;
  }

  DB.members.forEach((member) => {
    tbody.appendChild(
      el(
        "tr",
        {},
        el(
          "td",
          {},
          el(
            "div",
            { style: { display: "flex", alignItems: "center", gap: "10px" } },
            smallAvatar(member),
            el("strong", { text: member.name || "Unnamed", style: { color: "var(--chrome-light)" } }),
          ),
        ),
        el("td", {}, el("span", { text: member.role || "-", style: { color: "var(--blue)", fontFamily: "var(--font-mono)", fontSize: "0.7rem" } })),
        el("td", {}, skillTags(member.skills).slice(0, 3)),
        el("td", { text: member.year || "-" }),
        el("td", {}, tableActions(actionButton("EDIT", "btn-edit", () => openMemberForm(member.id)), actionButton("DELETE", "btn-delete", () => deleteMember(member.id)))),
      ),
    );
  });
}

/* ===== PROJECT ADMIN ===== */
function projectForm(project = {}) {
  return el(
    "div",
    {},
    formGroup("// PROJECT TITLE", textInput("pf-title", project.title || "", "Project Name", { maxLength: 120 })),
    formGroup("// DESCRIPTION", textareaInput("pf-desc", project.desc || "", "What does it do?", 600)),
    formRow(
      formGroup(
        "// CATEGORY",
        selectInput(
          "pf-cat",
          PROJECT_CATEGORIES.map((category) => ({ value: category, label: category.toUpperCase() })),
          project.category || "other",
        ),
      ),
      formGroup("// STATUS", selectInput("pf-status", PROJECT_STATUSES, project.status || "Active")),
    ),
    formRow(
      formGroup("// TECH STACK (comma separated)", textInput("pf-tech", project.tech || "", "React, Node.js, MongoDB", { maxLength: 250 })),
      formGroup("// ICON", textInput("pf-icon", project.icon || "CODE", "CODE", { maxLength: 16 })),
    ),
    formRow(
      formGroup("// GITHUB URL", textInput("pf-github", project.github_url || "#", "https://github.com/...", { maxLength: 300 })),
      formGroup("// DEMO URL", textInput("pf-demo", project.demo_url || "#", "https://example.com", { maxLength: 300 })),
    ),
  );
}

function openProjectForm(id) {
  formType = "project";
  if (id !== undefined && id !== null) {
    const project = DB.projects.find((item) => String(item.id) === String(id));
    if (!project) {
      showToast("Project not found", "error");
      return;
    }
    formMode = "edit";
    editId = project.id;
    openFormModal("EDIT PROJECT", projectForm(project));
    return;
  }

  formMode = "add";
  editId = null;
  openFormModal("ADD PROJECT", projectForm());
}

async function saveProjectData() {
  const button = byId("form-save-btn");

  try {
    requireAdminSession();
    if (button) {
      button.disabled = true;
      button.textContent = "SAVING...";
    }

    const project = {
      title: cleanText(getInputValue("pf-title"), { label: "Project title", max: 120, required: true }),
      desc: cleanText(getInputValue("pf-desc"), { label: "Description", max: 600, multiline: true }),
      category: enumValue(getInputValue("pf-cat"), PROJECT_CATEGORIES, "Category"),
      status: enumValue(getInputValue("pf-status"), PROJECT_STATUSES, "Status"),
      tech: cleanText(getInputValue("pf-tech"), { label: "Tech stack", max: 250 }),
      icon: cleanText(getInputValue("pf-icon"), { label: "Icon", max: 16 }) || "CODE",
      github_url: optionalHttpUrl(getInputValue("pf-github"), "GitHub URL"),
      demo_url: optionalHttpUrl(getInputValue("pf-demo"), "Demo URL"),
    };

    if (formMode === "add") {
      const { data, error } = await supabaseClient.from("projects").insert([project]).select();
      if (error) throw error;
      DB.projects.push(data[0]);
      showToast("Project added", "success");
    } else {
      const { data, error } = await supabaseClient.from("projects").update(project).eq("id", editId).select();
      if (error) throw error;
      const index = DB.projects.findIndex((item) => String(item.id) === String(editId));
      if (index >= 0) DB.projects[index] = data[0];
      showToast("Project updated", "success");
    }

    closeFormModal();
    renderAdminProjects();
    renderProjects();
    updateDashboardStats();
  } catch (error) {
    showToast(error.message || "Failed to save project", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "SAVE";
    }
  }
}

async function deleteProject(id) {
  if (!window.confirm("Delete this project?")) return;
  try {
    requireAdminSession();
    const { error } = await supabaseClient.from("projects").delete().eq("id", id);
    if (error) throw error;

    DB.projects = DB.projects.filter((project) => String(project.id) !== String(id));
    renderAdminProjects();
    renderProjects();
    updateDashboardStats();
    showToast("Project deleted", "info");
  } catch (error) {
    showToast(error.message || "Failed to delete project", "error");
  }
}

function renderAdminProjects() {
  const tbody = byId("projects-table-body");
  if (!tbody) return;
  clearNode(tbody);

  if (!DB.projects.length) {
    tbody.appendChild(emptyTableRow(5, "No projects yet."));
    return;
  }

  DB.projects.forEach((project) => {
    const statusColor =
      project.status === "Active" ? "#00ff88" : project.status === "Completed" ? "var(--blue)" : "rgba(200,200,220,0.3)";

    tbody.appendChild(
      el(
        "tr",
        {},
        el("td", {}, el("strong", { text: `${project.icon || ""} ${project.title || "Untitled"}`.trim(), style: { color: "var(--chrome-light)" } })),
        el("td", {}, el("span", { text: String(project.category || "other").toUpperCase(), style: { fontFamily: "var(--font-mono)", fontSize: "0.7rem", color: "var(--purple-light)" } })),
        el("td", {}, skillTags(project.tech).slice(0, 3)),
        el("td", {}, el("span", { text: `* ${project.status || "Archived"}`, style: { color: statusColor } })),
        el("td", {}, tableActions(actionButton("EDIT", "btn-edit", () => openProjectForm(project.id)), actionButton("DELETE", "btn-delete", () => deleteProject(project.id)))),
      ),
    );
  });
}

/* ===== EVENT ADMIN ===== */
function eventForm(eventItem = {}) {
  return el(
    "div",
    {},
    formGroup("// EVENT TITLE", textInput("ef-title", eventItem.title || "", "HackFest 2026", { maxLength: 120 })),
    formGroup("// DESCRIPTION", textareaInput("ef-desc", eventItem.desc || "", "About the event...", 600)),
    formRow(
      formGroup("// DATE", textInput("ef-date", eventItem.date || "", "", { type: "date" })),
      formGroup("// TYPE", selectInput("ef-type", EVENT_TYPES, eventItem.type || "Hackathon")),
    ),
    formRow(
      formGroup(
        "// STATUS",
        selectInput(
          "ef-status",
          EVENT_STATUSES.map((status) => ({ value: status, label: status.charAt(0).toUpperCase() + status.slice(1) })),
          eventItem.status || "upcoming",
        ),
      ),
      formGroup("// PARTICIPANTS", textInput("ef-part", String(eventItem.participants || ""), "100", { type: "number", min: 0, max: 100000 })),
    ),
    formGroup("// VENUE", textInput("ef-venue", eventItem.venue || "", "Campus Auditorium", { maxLength: 120 })),
  );
}

function openEventForm(id) {
  formType = "event";
  if (id !== undefined && id !== null) {
    const eventItem = DB.events.find((item) => String(item.id) === String(id));
    if (!eventItem) {
      showToast("Event not found", "error");
      return;
    }
    formMode = "edit";
    editId = eventItem.id;
    openFormModal("EDIT EVENT", eventForm(eventItem));
    return;
  }

  formMode = "add";
  editId = null;
  openFormModal("ADD EVENT", eventForm());
}

async function saveEventData() {
  const button = byId("form-save-btn");

  try {
    requireAdminSession();
    if (button) {
      button.disabled = true;
      button.textContent = "SAVING...";
    }

    const eventItem = {
      title: cleanText(getInputValue("ef-title"), { label: "Event title", max: 120, required: true }),
      desc: cleanText(getInputValue("ef-desc"), { label: "Description", max: 600, multiline: true }),
      date: dateValue(getInputValue("ef-date")),
      type: enumValue(getInputValue("ef-type"), EVENT_TYPES, "Type"),
      status: enumValue(getInputValue("ef-status"), EVENT_STATUSES, "Status"),
      participants: boundedInteger(getInputValue("ef-part"), { label: "Participants", min: 0, max: 100000 }),
      venue: cleanText(getInputValue("ef-venue"), { label: "Venue", max: 120 }),
    };

    if (formMode === "add") {
      const { data, error } = await supabaseClient.from("events").insert([eventItem]).select();
      if (error) throw error;
      DB.events.push(data[0]);
      showToast("Event added", "success");
    } else {
      const { data, error } = await supabaseClient.from("events").update(eventItem).eq("id", editId).select();
      if (error) throw error;
      const index = DB.events.findIndex((item) => String(item.id) === String(editId));
      if (index >= 0) DB.events[index] = data[0];
      showToast("Event updated", "success");
    }

    closeFormModal();
    renderAdminEvents();
    renderEvents();
    updateDashboardStats();
  } catch (error) {
    showToast(error.message || "Failed to save event", "error");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "SAVE";
    }
  }
}

async function deleteEvent(id) {
  if (!window.confirm("Delete this event?")) return;
  try {
    requireAdminSession();
    const { error } = await supabaseClient.from("events").delete().eq("id", id);
    if (error) throw error;

    DB.events = DB.events.filter((eventItem) => String(eventItem.id) !== String(id));
    renderAdminEvents();
    renderEvents();
    updateDashboardStats();
    showToast("Event deleted", "info");
  } catch (error) {
    showToast(error.message || "Failed to delete event", "error");
  }
}

function renderAdminEvents() {
  const tbody = byId("events-table-body");
  if (!tbody) return;
  clearNode(tbody);

  if (!DB.events.length) {
    tbody.appendChild(emptyTableRow(5, "No events yet."));
    return;
  }

  DB.events.forEach((eventItem) => {
    const status = safeStatusClass(eventItem.status);
    tbody.appendChild(
      el(
        "tr",
        {},
        el("td", {}, el("strong", { text: eventItem.title || "Untitled", style: { color: "var(--chrome-light)" } })),
        el("td", {}, el("span", { text: formatDate(eventItem.date), style: { fontFamily: "var(--font-mono)", fontSize: "0.7rem" } })),
        el("td", { text: eventItem.type || "Event" }),
        el("td", {}, el("span", { className: `event-status status-${status}`, text: status.toUpperCase(), style: { fontSize: "0.6rem" } })),
        el("td", {}, tableActions(actionButton("EDIT", "btn-edit", () => openEventForm(eventItem.id)), actionButton("DELETE", "btn-delete", () => deleteEvent(eventItem.id)))),
      ),
    );
  });
}

function saveFormData() {
  if (formType === "member") saveMemberData();
  if (formType === "project") saveProjectData();
  if (formType === "event") saveEventData();
}

/* ===== STATS ADMIN ===== */
function loadStatsForm() {
  setInputValue("stat-members", DB.stats?.members_count || 0);
  setInputValue("stat-projects", DB.stats?.projects_count || 0);
  setInputValue("stat-hackathons", DB.stats?.hackathons_count || 0);
  setInputValue("stat-awards", DB.stats?.awards_count || 0);
}

async function saveStats() {
  try {
    requireAdminSession();
    const nextStats = {
      members_count: boundedInteger(getInputValue("stat-members"), { label: "Members", min: 0, max: 100000 }),
      projects_count: boundedInteger(getInputValue("stat-projects"), { label: "Projects", min: 0, max: 100000 }),
      hackathons_count: boundedInteger(getInputValue("stat-hackathons"), { label: "Hackathons", min: 0, max: 100000 }),
      awards_count: boundedInteger(getInputValue("stat-awards"), { label: "Awards", min: 0, max: 100000 }),
      updated_at: new Date().toISOString(),
    };

    const response = DB.stats?.id
      ? await supabaseClient.from("stats").update(nextStats).eq("id", DB.stats.id).select()
      : await supabaseClient.from("stats").insert([nextStats]).select();

    if (response.error) throw response.error;
    DB.stats = response.data[0];
    updatePublicStats();
    animateCounters();
    showToast("Stats updated", "success");
  } catch (error) {
    showToast(error.message || "Failed to update stats", "error");
  }
}

/* ===== CODE RAIN ===== */
function initCodeRain() {
  if (byId("code-rain")) return;

  const canvas = el("canvas", {
    id: "code-rain",
    style: {
      position: "fixed",
      top: "0",
      left: "0",
      width: "100%",
      height: "100%",
      zIndex: "1",
      pointerEvents: "none",
      opacity: "0.03",
    },
  });
  document.body.appendChild(canvas);

  const context = canvas.getContext("2d");
  if (!context) return;

  let columns = 0;
  let drops = [];

  function setupCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    columns = Math.floor(canvas.width / 16);
    drops = Array(columns).fill(1);
  }

  setupCanvas();
  window.addEventListener("resize", debounce(setupCanvas, 200));

  const chars = "01</>{}[]=>+-*&|^%$#@!";
  let lastTime = 0;

  addAnimationCallback((time) => {
    if (time - lastTime < 50) return;
    lastTime = time;

    context.fillStyle = "rgba(2,2,10,0.05)";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#7b2fff";
    context.font = "12px Share Tech Mono";

    for (let index = 0; index < columns; index += 1) {
      const character = chars[Math.floor(Math.random() * chars.length)];
      context.fillText(character, index * 16, drops[index] * 16);
      if (drops[index] * 16 > canvas.height && Math.random() > 0.975) drops[index] = 0;
      drops[index] += 1;
    }
  });
}

/* ===== STATIC EVENTS ===== */
function wireStaticEvents() {
  let scrollScheduled = false;
  window.addEventListener(
    "scroll",
    () => {
      if (scrollScheduled) return;
      scrollScheduled = true;
      window.requestAnimationFrame(() => {
        byId("navbar")?.classList.toggle("scrolled", window.scrollY > 20);
        scrollScheduled = false;
      });
    },
    { passive: true },
  );

  byId("nav-logo")?.addEventListener("click", () => navigateTo("home"));
  byId("nav-admin-btn")?.addEventListener("click", openAdminModal);
  byId("hamburger")?.addEventListener("click", toggleMobileMenu);
  byId("mobile-menu")?.addEventListener("click", (event) => {
    if (isElement(event.target) && event.target.closest("a")) closeMobileMenu();
  });

  byId("project-filters")?.addEventListener("click", (event) => {
    if (!isElement(event.target) || !event.target.classList.contains("filter-btn")) return;
    document.querySelectorAll(".filter-btn").forEach((button) => button.classList.remove("active"));
    event.target.classList.add("active");
    renderProjects(event.target.dataset.filter);
  });

  byId("contact-form")?.addEventListener("submit", submitContactForm);
  byId("login-close-btn")?.addEventListener("click", closeAdminModal);
  byId("admin-login-btn")?.addEventListener("click", doLogin);
  byId("admin-logout-btn")?.addEventListener("click", doLogout);
  byId("save-stats-btn")?.addEventListener("click", saveStats);
  byId("form-modal-close-btn")?.addEventListener("click", closeFormModal);
  byId("form-save-btn")?.addEventListener("click", saveFormData);
  byId("form-cancel-btn")?.addEventListener("click", closeFormModal);

  byId("admin-pass")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") doLogin();
  });

  document.querySelector(".admin-sidebar")?.addEventListener("click", (event) => {
    if (!isElement(event.target)) return;
    const item = event.target.closest(".admin-nav-item");
    if (!item) return;

    if (item.dataset.adminAction === "close") {
      closeAdminPanel();
      return;
    }

    if (item.dataset.adminSection) switchAdminSection(item.dataset.adminSection, item);
  });

  document.querySelector(".admin-main")?.addEventListener("click", (event) => {
    if (!isElement(event.target)) return;
    const button = event.target.closest("[data-open-form]");
    if (!button) return;

    if (button.dataset.adminJump) {
      const navItem = document.querySelector(`[data-admin-section="${button.dataset.adminJump}"]`);
      switchAdminSection(button.dataset.adminJump, navItem);
    }

    if (button.dataset.openForm === "member") openMemberForm();
    if (button.dataset.openForm === "project") openProjectForm();
    if (button.dataset.openForm === "event") openEventForm();
  });

  byId("admin-modal")?.addEventListener("click", (event) => {
    if (event.target === byId("admin-modal")) closeAdminModal();
  });

  byId("form-modal")?.addEventListener("click", (event) => {
    if (event.target === byId("form-modal")) closeFormModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAdminModal();
      closeFormModal();
    }
  });

  window.addEventListener("hashchange", handleRoute);
  window.addEventListener("popstate", handleRoute);
}

/* ===== INIT ===== */
document.addEventListener("DOMContentLoaded", async () => {
  initThreeBackground();
  initCursor();
  initHexGrid();
  initGSAP();
  wireStaticEvents();

  await initSupabaseClient();
  await checkSession();
  await loadDB();

  handleRoute();
  hideLoading();
  showConfigNotice();

  window.setTimeout(initMagneticButtons, 1500);
  window.setTimeout(initCodeRain, 1800);
});

Object.assign(window, {
  navigateTo,
  toggleMobileMenu,
  closeMobileMenu,
  openAdminModal,
  closeAdminModal,
  doLogin,
  doLogout,
  closeAdminPanel,
  switchAdminSection,
  openMemberForm,
  openProjectForm,
  openEventForm,
  closeFormModal,
  saveFormData,
  saveStats,
  submitContactForm,
  removePhoto,
  deleteMember,
  deleteProject,
  deleteEvent,
});
