const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const list = document.querySelector("#task-list");
const emptyMessage = document.querySelector("#empty-message");

const storageKey = "my-todo-tasks";
let tasks = loadTasks();

function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));

    if (!Array.isArray(saved)) return [];

    return saved.filter(task =>
      task &&
      typeof task.id === "string" &&
      typeof task.text === "string" &&
      typeof task.completed === "boolean"
    );
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
  } catch {
    alert("Не удалось сохранить задачи в браузере.");
  }
}

function renderTasks() {
  list.replaceChildren();
  emptyMessage.hidden = tasks.length > 0;

  tasks.forEach(task => {
    const item = document.createElement("li");
    item.className = task.completed ? "task completed" : "task";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `task-${task.id}`;
    checkbox.checked = task.completed;

    const label = document.createElement("label");
    label.htmlFor = checkbox.id;
    label.textContent = task.text;

    checkbox.addEventListener("change", () => {
      task.completed = checkbox.checked;
      saveTasks();
      renderTasks();
    });

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "delete-button";
    deleteButton.textContent = "Удалить";
    deleteButton.setAttribute("aria-label", `Удалить задачу: ${task.text}`);

    deleteButton.addEventListener("click", () => {
      tasks = tasks.filter(item => item.id !== task.id);
      saveTasks();
      renderTasks();
    });

    item.append(checkbox, label, deleteButton);
    list.append(item);
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();

  const text = input.value.trim();
  if (!text) return;

  tasks.push({
    id: crypto.randomUUID(),
    text,
    completed: false
  });

  saveTasks();
  renderTasks();
  form.reset();
  input.focus();
});

renderTasks();
