export function escapeHtml(value) {
    const element = document.createElement("div");
    element.textContent = String(value);
    return element.innerHTML;
}

export async function submitScore({ name, score, level }) {
    const response = await fetch("/api/scores", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        body: JSON.stringify({ name: name.trim(), score, level }),
    });

    if (!response.ok) {
        let message = "Výsledek se nepodařilo uložit.";
        try {
            const payload = await response.json();
            message = typeof payload.detail === "string" ? payload.detail : message;
        } catch {
            // Keep a safe, user-facing fallback for non-JSON server errors.
        }
        throw new Error(message);
    }
    return response.json();
}

export function refreshLeaderboards() {
    document.querySelectorAll("[data-leaderboard]").forEach((target) => {
        if (window.htmx) {
            window.htmx.ajax("GET", "/partials/leaderboard", {
                target,
                swap: "innerHTML",
            });
        }
    });
}
