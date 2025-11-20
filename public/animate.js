// animate.js — simple animations

function flashRed(container) {
    const orig = container.tint;
    container.tint = 0xff0000;
    setTimeout(() => container.tint = orig, 120);
}
