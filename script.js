// Toggle mobile menu
const hamburger = document.getElementById("hamburger");
const navLinks = document.querySelector(".nav-links");
const projectsBtn = document.getElementById("projectsBtn");

hamburger.addEventListener("click", () => {
    navLinks.classList.toggle("active");
});

// Redirect button
projectsBtn.addEventListener("click", () => {
    window.location.href = "projects.html";
});
