const container = document.createElement("div");
container.innerHTML = `
<div style="background-color: red; height: 30px; font-weight: bold; color: white; padding-left: 30px">
Warning: This is the production environment. Click to dismiss
</div>
`.trim();

container.addEventListener("click", () => {
  document.body.removeChild(container);
});

document.body.prepend(container);
