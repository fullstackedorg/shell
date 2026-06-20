import type { Terminal } from "@xterm/xterm";
import { copyText } from "./clipboard";

export function setupUtilityButtons(
    handleInput: (data: string) => void,
    terminal: Terminal
) {
    const isTouchDevice =
        "ontouchstart" in window || navigator.maxTouchPoints > 0;

    if (!isTouchDevice) return;

    const container = document.createElement("div");
    container.id = "shell-touch-toolbar";
    Object.assign(container.style, {
        position: "fixed",
        top: "calc(50% - 20px)",
        right: "20px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-end",
        gap: "8px",
        zIndex: "1000",
        userSelect: "none",
        touchAction: "none" // Prevent scrolling while dragging
    });

    const toolbar = document.createElement("div");
    Object.assign(toolbar.style, {
        position: "absolute",
        display: "none", // use display instead of transform/opacity for better layout control
        gap: "8px",
        padding: "8px",
        background: "rgba(30, 30, 30, 0.95)",
        backdropFilter: "blur(4px)",
        border: "1px solid #444",
        borderRadius: "12px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
        zIndex: "1001"
    });

    const toggleBtn = document.createElement("button");
    toggleBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
    Object.assign(toggleBtn.style, {
        width: "40px",
        height: "40px",
        borderRadius: "50%",
        background: "#333",
        color: "#fff",
        border: "1px solid #555",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)"
    });

    const PADDING = 10;

    const updatePosition = () => {
        if (isCollapsed) return;
        // Get dimensions
        const btnRect = toggleBtn.getBoundingClientRect();
        // Show momentarily to measure, if hidden
        toolbar.style.display = "flex";
        const tbRect = toolbar.getBoundingClientRect();

        // Calculate available space
        const spaceTop = btnRect.top;
        const spaceLeft = btnRect.left;

        // Vertical positioning: default top, fallback bottom
        if (spaceTop >= tbRect.height + PADDING) {
            toolbar.style.bottom = "48px"; // Place above button
            toolbar.style.top = "auto";
        } else {
            toolbar.style.top = "48px"; // Place below button
            toolbar.style.bottom = "auto";
        }

        // Horizontal positioning: default right-aligned (left expansion), fallback left-aligned
        if (spaceLeft + btnRect.width >= tbRect.width) {
            toolbar.style.right = "0px";
            toolbar.style.left = "auto";
        } else {
            toolbar.style.left = "0px";
            toolbar.style.right = "auto";
        }
    };

    let isCollapsed = true;
    toggleBtn.onclick = () => {
        isCollapsed = !isCollapsed;
        if (!isCollapsed) {
            updatePosition();
        } else {
            toolbar.style.display = "none";
        }
    };

    const createButton = (
        label: string | HTMLElement | SVGElement,
        onClick: () => void
    ) => {
        const btn = document.createElement("button");
        if (typeof label === "string") {
            btn.textContent = label;
        } else {
            btn.appendChild(label);
        }
        Object.assign(btn.style, {
            background: "rgba(255, 255, 255, 0.25)",
            color: "#fff",
            border: "none",
            borderRadius: "8px",
            fontSize: "14px",
            fontWeight: "normal",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "72px",
            height: "64px",
            transition: "background 0.1s"
        });
        let touchTriggered = false;

        const trigger = (e: Event) => {
            e.preventDefault();
            e.stopPropagation();
            onClick();
            // Refocus terminal to ensure it retains input focus
            terminal.focus();
        };

        btn.addEventListener("click", (e) => {
            if (touchTriggered) {
                touchTriggered = false;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            trigger(e);
        });

        btn.addEventListener(
            "touchstart",
            (e) => {
                touchTriggered = true;
                btn.style.background = "rgba(255, 255, 255, 0.4)";
                trigger(e);
            },
            { passive: false }
        );

        btn.addEventListener("touchend", (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.style.background = "rgba(255, 255, 255, 0.25)";
        });

        btn.addEventListener("mouseenter", () => {
            btn.style.background = "rgba(255, 255, 255, 0.35)";
        });

        btn.addEventListener("mouseleave", () => {
            btn.style.background = "rgba(255, 255, 255, 0.25)";
        });

        btn.addEventListener("mousedown", (e) => {
            e.preventDefault(); // Prevent focus stealing from terminal
            e.stopPropagation();
            btn.style.background = "rgba(255, 255, 255, 0.4)";
        });

        btn.addEventListener("mouseup", (e) => {
            e.preventDefault();
            e.stopPropagation();
            btn.style.background = "rgba(255, 255, 255, 0.35)";
        });

        return btn;
    };

    const createPolyIcon = (points: string) => {
        const svg = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        );
        svg.setAttribute("width", "16");
        svg.setAttribute("height", "16");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("fill", "currentColor");
        const poly = document.createElementNS(
            "http://www.w3.org/2000/svg",
            "polygon"
        );
        poly.setAttribute("points", points);
        svg.appendChild(poly);
        return svg;
    };

    // Grid Container
    const gridContainer = document.createElement("div");
    Object.assign(gridContainer.style, {
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: "8px"
    });

    // Row 1: Arrows
    const leftBtn = createButton(createPolyIcon("17,4 17,20 6,12"), () =>
        handleInput("\x1b[D")
    );
    const downBtn = createButton(createPolyIcon("4,7 20,7 12,18"), () =>
        handleInput("\x1b[B")
    );
    const upBtn = createButton(createPolyIcon("4,17 20,17 12,6"), () =>
        handleInput("\x1b[A")
    );
    const rightBtn = createButton(createPolyIcon("7,4 7,20 18,12"), () =>
        handleInput("\x1b[C")
    );

    // Row 2 & 3: Operation Buttons
    const pasteBtn = createButton("PASTE", () => {
        ((globalThis as any).paste || navigator.clipboard.readText)().then(
            (text: string) => {
                if (text) {
                    for (const char of text) handleInput(char);
                }
            }
        );
    });

    const tabBtn = createButton("TAB", () => handleInput("\t"));
    const ctrlCBtn = createButton("Ctrl+C", () => handleInput("\u0003"));

    const enterBtn = createButton("Enter", () => handleInput("\r"));
    enterBtn.style.gridColumn = "span 2";
    enterBtn.style.width = "100%";

    const escBtn = createButton("ESC", () => handleInput("\x1b"));
    escBtn.style.gridColumn = "span 2";
    escBtn.style.width = "100%";

    const copyBtn = createButton("COPY", () => {
        const text = terminal.getSelection();
        if (text) {
            if ((globalThis as any).copy) {
                (globalThis as any).copy(text);
            } else {
                copyText(text);
            }
        }
    });

    gridContainer.append(
        leftBtn,
        downBtn,
        upBtn,
        rightBtn,
        copyBtn,
        pasteBtn,
        tabBtn,
        ctrlCBtn,
        escBtn,
        enterBtn
    );

    toolbar.appendChild(gridContainer);

    // Dragging logic
    let isDragging = false;
    let startX: number, startY: number;
    let initialRight: number, initialBottom: number;

    const onStart = (e: MouseEvent | TouchEvent) => {
        const isButton = (e.target as HTMLElement).closest("button");
        // Only initiate drag if clicking on the toggle button itself (or its SVG), not the toolbar
        if (isButton && isButton !== toggleBtn) return;
        if (e.target === toolbar || toolbar.contains(e.target as Node)) return;

        isDragging = true;
        const clientX =
            e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
        const clientY =
            e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
        startX = clientX;
        startY = clientY;
        const rect = container.getBoundingClientRect();
        initialRight = window.innerWidth - rect.right;
        initialBottom = window.innerHeight - rect.bottom;
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
        if (!isDragging) return;
        const clientX =
            e instanceof MouseEvent ? e.clientX : e.touches[0].clientX;
        const clientY =
            e instanceof MouseEvent ? e.clientY : e.touches[0].clientY;
        const dx = startX - clientX;
        const dy = startY - clientY;

        // Calculate new positions, clamping to screen boundaries
        const maxRight = window.innerWidth - toggleBtn.offsetWidth;
        const maxBottom = window.innerHeight - toggleBtn.offsetHeight;
        let newRight = initialRight + dx;
        let newBottom = initialBottom + dy;

        newRight = Math.max(0, Math.min(newRight, maxRight));
        newBottom = Math.max(0, Math.min(newBottom, maxBottom));

        container.style.top = "auto";
        container.style.right = `${newRight}px`;
        container.style.bottom = `${newBottom}px`;

        if (!isCollapsed) {
            updatePosition();
        }
    };

    const onEnd = () => {
        isDragging = false;
    };

    container.addEventListener("mousedown", onStart);
    container.addEventListener("touchstart", onStart, { passive: false });
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", onEnd);
    window.addEventListener("touchend", onEnd);

    container.appendChild(toolbar);
    container.appendChild(toggleBtn);
    document.body.appendChild(container);
}
