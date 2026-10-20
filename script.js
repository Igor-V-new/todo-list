const form = document.querySelector("#task-form");
const input = document.querySelector("#task-input");
const dateInput = document.querySelector("#task-date");
const priorityInput = document.querySelector("#task-priority");

const list = document.querySelector("#task-list");
const emptyMessage = document.querySelector("#empty-message");
const taskCounter = document.querySelector("#task-counter");
const clearCompletedButton = document.querySelector("#clear-completed");
const filterButtons = document.querySelectorAll(".filter-button");

const storageKey = "my-todo-tasks";

const priorityLabels = {
  normal: "Обычный",
  important: "Важный",
  urgent: "Срочный"
};

let currentFilter = "all";
let tasks = loadTasks();

// Загрузка задач и поддержка старого формата сохранения.
function loadTasks() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));

    if (!Array.isArray(saved)) {
      return [];
    }

    return saved
      .filter(task =>
        task &&
        typeof task.id === "string" &&
        typeof task.text === "string" &&
        typeof task.completed === "boolean"
      )
      .map(task => ({
        id: task.id,
        text: task.text,
        completed: task.completed,
        dueDate:
          typeof task.dueDate === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(task.dueDate)
            ? task.dueDate
            : "",
        priority:
          Object.hasOwn(priorityLabels, task.priority)
            ? task.priority
            : "normal"
      }));
  } catch {
    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
  } catch {
    alert(
      "Не удалось сохранить задачи. " +
      "Изменения могут пропасть после закрытия страницы."
    );
  }
}

// Сегодняшняя дата по местному времени.
function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function getVisibleTasks() {
  if (currentFilter === "active") {
    return tasks.filter(task => !task.completed);
  }

  if (currentFilter === "completed") {
    return tasks.filter(task => task.completed);
  }

  return tasks;
}

// Редактирование текста через стандартное окно браузера.
function editTask(task) {
  const answer = prompt("Измени текст задачи:", task.text);

  if (answer === null) {
    return;
  }

  const text = answer.trim();

  if (!text) {
    alert("Текст задачи не должен быть пустым.");
    return;
  }

  if (text.length > 200) {
    alert("Максимальная длина задачи — 200 символов.");
    return;
  }

  task.text = text;
  saveTasks();
  renderTasks();
}

function createTaskElement(task, today) {
  const item = document.createElement("li");
  item.className = task.completed ? "task completed" : "task";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "task-checkbox";
  checkbox.id = `task-${task.id}`;
  checkbox.checked = task.completed;

  checkbox.addEventListener("change", () => {
    task.completed = checkbox.checked;
    saveTasks();
    renderTasks();
  });

  const content = document.createElement("div");
  content.className = "task-content";

  const label = document.createElement("label");
  label.className = "task-title";
  label.htmlFor = checkbox.id;
  label.textContent = task.text;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  const priorityBadge = document.createElement("span");
  priorityBadge.className = `badge priority-${task.priority}`;
  priorityBadge.textContent =
    `Приоритет: ${priorityLabels[task.priority]}`;

  meta.append(priorityBadge);

  if (task.dueDate) {
    const dateBadge = document.createElement("span");
    dateBadge.className = "badge";

    const isOverdue = !task.completed && task.dueDate < today;

    if (isOverdue) {
      dateBadge.classList.add("overdue");
      dateBadge.textContent =
        `Просрочено: ${formatDate(task.dueDate)}`;
    } else {
      dateBadge.textContent =
        `Срок: ${formatDate(task.dueDate)}`;
    }

    meta.append(dateBadge);
  }

  content.append(label, meta);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editButton = document.createElement("button");
  editButton.type = "button";
  editButton.className = "edit-button";
  editButton.textContent = "Изменить";
  editButton.setAttribute(
    "aria-label",
    `Изменить текст задачи: ${task.text}`
  );

  editButton.addEventListener("click", () => {
    editTask(task);
  });

  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "delete-button";
  deleteButton.textContent = "Удалить";
  deleteButton.setAttribute(
    "aria-label",
    `Удалить задачу: ${task.text}`
  );

  deleteButton.addEventListener("click", () => {
    tasks = tasks.filter(item => item.id !== task.id);
    saveTasks();
    renderTasks();
  });

  actions.append(editButton, deleteButton);
  item.append(checkbox, content, actions);

  return item;
}

function renderTasks() {
  list.replaceChildren();

  const visibleTasks = getVisibleTasks();
  const remaining = tasks.filter(task => !task.completed).length;
  const completedCount = tasks.length - remaining;
  const today = getToday();

  taskCounter.textContent = `Осталось задач: ${remaining}`;

  clearCompletedButton.disabled = completedCount === 0;
  clearCompletedButton.textContent =
    `Удалить выполненные (${completedCount})`;

  filterButtons.forEach(button => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.filter === currentFilter)
    );
  });

  emptyMessage.hidden = visibleTasks.length > 0;

  if (tasks.length === 0) {
    emptyMessage.textContent = "Пока задач нет. Добавь первую!";
  } else if (currentFilter === "active") {
    emptyMessage.textContent = "Активных задач нет. Всё сделано!";
  } else if (currentFilter === "completed") {
    emptyMessage.textContent = "Выполненных задач пока нет.";
  } else {
    emptyMessage.textContent = "";
  }

  visibleTasks.forEach(task => {
    list.append(createTaskElement(task, today));
  });
}

form.addEventListener("submit", event => {
  event.preventDefault();

  const text = input.value.trim();

  if (!text) {
    input.focus();
    return;
  }

  tasks.push({
    id: crypto.randomUUID(),
    text,
    completed: false,
    dueDate: dateInput.value,
    priority: priorityInput.value
  });

  saveTasks();
  renderTasks();
  form.reset();
  input.focus();
});

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    renderTasks();
  });
});

clearCompletedButton.addEventListener("click", () => {
  const completedCount = tasks.filter(task => task.completed).length;

  if (completedCount === 0) {
    return;
  }

  const confirmed = confirm(
    `Удалить выполненные задачи (${completedCount})? ` +
    "Это действие нельзя отменить."
  );

  if (!confirmed) {
    return;
  }

  tasks = tasks.filter(task => !task.completed);
  saveTasks();
  renderTasks();
});

// Обновляем отметки просрочки при возвращении на вкладку.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    renderTasks();
  }
});

renderTasks();
