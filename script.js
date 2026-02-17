const hamburger = document.getElementById("hamburger");
const navLinks = document.querySelector(".nav-links");
const projectsBtn = document.getElementById("projectsBtn");

hamburger.addEventListener("click", () => {
    navLinks.classList.toggle("active");
});

projectsBtn.addEventListener("click", () => {
    window.location.href = "projects.html";
});

document.addEventListener("DOMContentLoaded", function () {

    // ==============================
    // GitHub API
    // ==============================
    fetch("https://api.github.com/users/ahmarius")
        .then(response => response.json())
        .then(data => {
            document.getElementById("ghUser").innerText = data.login;
            document.getElementById("ghRepos").innerText = data.public_repos;
            document.getElementById("ghFollowers").innerText = data.followers;
        })
        .catch(() => {
            document.getElementById("ghUser").innerText = "Unavailable";
        });

    // ==============================
    // World Time API (Bucharest)
    // ==============================
    fetch("https://worldtimeapi.org/api/timezone/Europe/Bucharest")
        .then(response => response.json())
        .then(data => {
            const datetime = new Date(data.datetime);
            document.getElementById("bucharestTime").innerText =
                datetime.toLocaleTimeString();
        })
        .catch(() => {
            document.getElementById("bucharestTime").innerText =
                "Could not load time";
        });

    // ==============================
    // Programming Joke API
    // ==============================
    fetch("https://v2.jokeapi.dev/joke/Programming?type=single")
        .then(response => response.json())
        .then(data => {
            document.getElementById("jokeText").innerText = data.joke;
        })
        .catch(() => {
            document.getElementById("jokeText").innerText =
                "Could not load joke.";
        });

});

