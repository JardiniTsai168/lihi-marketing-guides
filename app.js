const revealElements = document.querySelectorAll(".reveal");
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const siteNav = document.querySelector("#site-nav");
const hamburger = document.querySelector(".nav-hamburger");
const mobileMenu = document.querySelector("#mobile-menu");
const mobileOverlay = document.querySelector(".mobile-overlay");
const mobileSubmenuToggle = document.querySelector(".mobile-submenu-toggle");
const mobileSubmenu = document.querySelector(".mobile-submenu");
const desktopDropdown = document.querySelector(".has-dropdown");
const desktopDropdownToggle = document.querySelector(".dropdown-toggle");

const updateNavState = () => siteNav.classList.toggle("is-scrolled", window.scrollY > 8);

const closeDesktopDropdown = () => {
  desktopDropdown.classList.remove("is-open");
  desktopDropdownToggle.setAttribute("aria-expanded", "false");
};

const closeMobileMenu = () => {
  hamburger.classList.remove("is-open");
  hamburger.setAttribute("aria-expanded", "false");
  hamburger.setAttribute("aria-label", "開啟選單");
  mobileMenu.classList.remove("is-open");
  mobileMenu.setAttribute("aria-hidden", "true");
  mobileOverlay.classList.remove("is-open");
  document.body.classList.remove("menu-open");
};

const openMobileMenu = () => {
  hamburger.classList.add("is-open");
  hamburger.setAttribute("aria-expanded", "true");
  hamburger.setAttribute("aria-label", "關閉選單");
  mobileMenu.classList.add("is-open");
  mobileMenu.setAttribute("aria-hidden", "false");
  mobileOverlay.classList.add("is-open");
  document.body.classList.add("menu-open");
};

updateNavState();
window.addEventListener("scroll", updateNavState, { passive: true });

desktopDropdownToggle.addEventListener("click", () => {
  const willOpen = !desktopDropdown.classList.contains("is-open");
  desktopDropdown.classList.toggle("is-open", willOpen);
  desktopDropdownToggle.setAttribute("aria-expanded", String(willOpen));
});

hamburger.addEventListener("click", () => {
  if (mobileMenu.classList.contains("is-open")) closeMobileMenu();
  else openMobileMenu();
});

mobileOverlay.addEventListener("click", closeMobileMenu);

mobileSubmenuToggle.addEventListener("click", () => {
  const willOpen = !mobileSubmenu.classList.contains("is-open");
  mobileSubmenu.classList.toggle("is-open", willOpen);
  mobileSubmenuToggle.setAttribute("aria-expanded", String(willOpen));
});

mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMobileMenu));

document.addEventListener("click", (event) => {
  if (!desktopDropdown.contains(event.target)) closeDesktopDropdown();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeDesktopDropdown();
  closeMobileMenu();
  hamburger.focus();
});

window.matchMedia("(min-width: 761px)").addEventListener("change", (event) => {
  if (event.matches) closeMobileMenu();
});

if (prefersReducedMotion || !("IntersectionObserver" in window)) {
  revealElements.forEach((element) => element.classList.add("is-visible"));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8%", threshold: 0.08 },
  );

  revealElements.forEach((element) => observer.observe(element));
}

const toast = document.querySelector(".download-toast");
let toastTimer;

document.querySelectorAll("[data-download]").forEach((link) => {
  link.addEventListener("click", () => {
    window.clearTimeout(toastTimer);
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
  });
});

document.querySelector("#year").textContent = new Date().getFullYear();
