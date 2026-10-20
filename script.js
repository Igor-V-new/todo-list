"use strict";

const $ = selector => document.querySelector(selector);

const form = $("#task-form");
const input = $("#task-input");
const dateInput = $("#task-date");
const priorityInput = $("#task-priority");

const list = $("#task-list");
const searchInput = $("#search-input");
const sortSelect = $("#sort-select");
const filterButtons = document.querySelectorAll(".filter-button");

const emptyState = $("#empty-state");
const emptyTitle = $("#empty-title");
const emptyDescription = $("#empty-description");

const clearButton = $("#clear-completed");
const toggleVisibleButton = $("#toggle-visible");
const undoButton = $("#undo-button");
const statusMessage = $("#status-message");

const editDialog = $("#edit-dialog");
const editForm = $("#edit-form");
const editText = $("#edit-text");
const editDate = $("#edit-date");
const editPriority = $("#edit-priority");

const importFile = $("#import-file");
const themeButton = $("#theme-toggle");

const storageKey = "my-todo-tasks";
const themeKey = "my-todo-theme";
const maxTasks = 5000;

const priorityLabels = {
  normal: "Обычный",
  important: "Важный",
  urgent: "Срочный"
};

const priorityWeights = {
  normal: 1,
  important: 2,
  urgent: 3
};

let currentFilter = "all";
let editingId = null;
let undoSnapshot = null;
let tasks = loadTasks();

initializeTheme();
render();

// ---------- Даты и проверка данных ----------

function getToday() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function isValidDate(value) {
  if (value === "") {
    return true;
  }

  if (typeof value !== "string") {
    return false;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (year < 1 || year > 9999) {
    return false;
  }

  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDate(value) {
  const [year, month, day] = value.split("-");
  return `${day}.${month}.${year}`;
}

function isOverdue(task, today = getToday()) {
  return (
    !task.completed &&
    Boolean(task.dueDate) &&
    task.dueDate < today
  );
}

function isValidPriority(value) {
  return Object.hasOwn(priorityLabels, value);
}

function cloneTasks(value) {
  return value.map(task => ({ ...task }));
}

// ---------- Хранение ----------

function loadTasks() {
  try {
    const raw = localStorage.getItem(storageKey);

    if (raw === null) {
      return [];
    }

    const saved = JSON.parse(raw);

    if (!Array.isArray(saved)) {
      throw new Error("Неверный формат сохранения");
    }

    const usedIds = new Set();

    return saved
      .filter(task =>
        task &&
        typeof task.id === "string" &&
        typeof task.text === "string" &&
        typeof task.completed === "boolean"
      )
      .map((task, index) => {
        let id = task.id;

        if (!id || usedIds.has(id)) {
          id = crypto.randomUUID();
        }

        usedIds.add(id);

        return {
          id,
          text: task.text,
          completed: task.completed,
          dueDate: isValidDate(task.dueDate) ? task.dueDate : "",
          priority: isValidPriority(task.priority)
            ? task.priority
            : "normal",
          createdAt:
            Number.isFinite(task.createdAt) && task.createdAt >= 0
              ? task.createdAt
              : index
        };
      });
  } catch {
    notify(
      "Не удалось прочитать сохранение. " +
      "Если раньше были задачи, не добавляй новые до проверки данных.",
      true
    );

    return [];
  }
}

function saveTasks() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(tasks));
    return true;
  } catch {
    notify(
      "Браузер не сохранил изменения. " +
      "Скачай задачи в файл, чтобы не потерять их.",
      true
    );

    return false;
  }
}

function notify(message, error = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", error);
}

function commitChange(nextTasks, message) {
  undoSnapshot = cloneTasks(tasks);
  tasks = nextTasks;

  const saved = saveTasks();
  render();

  if (saved) {
    notify(message);
  }
}

// ---------- Тема ----------

function initializeTheme() {
  let theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  try {
    const savedTheme = localStorage.getItem(themeKey);

    if (savedTheme === "dark" || savedTheme === "light") {
      theme = savedTheme;
    }
  } catch {
    // Приложение работает и без сохранения темы.
  }

  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;

  const nextThemeName = theme === "dark"
    ? "Светлая тема"
    : "Тёмная тема";

  themeButton.textContent = nextThemeName;
  themeButton.setAttribute("aria-label", `Включить: ${nextThemeName}`);
}

themeButton.addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark"
    ? "light"
    : "dark";

  applyTheme(theme);

  try {
    localStorage.setItem(themeKey, theme);
  } catch {
    notify("Тема изменена, но браузер не смог запомнить выбор.", true);
  }
});

// ---------- Поиск, фильтры и сортировка ----------

function getVisibleTasks() {
  const query = searchInput.value.trim().toLocaleLowerCase("ru");
  const today = getToday();

  const visible = tasks.filter(task => {
    const matchesSearch = task.text
      .toLocaleLowerCase("ru")
      .includes(query);

    if (!matchesSearch) {
      return false;
    }

    if (currentFilter === "active") {
      return !task.completed;
    }

    if (currentFilter === "completed") {
      return task.completed;
    }

    if (currentFilter === "overdue") {
      return isOverdue(task, today);
    }

    return true;
  });

  visible.sort((a, b) => {
    switch (sortSelect.value) {
      case "oldest":
        return a.createdAt - b.createdAt;

      case "deadline": {
        const firstDate = a.dueDate || "9999-99-99";
        const secondDate = b.dueDate || "9999-99-99";

        return (
          firstDate.localeCompare(secondDate) ||
          b.createdAt - a.createdAt
        );
      }

      case "priority":
        return (
          priorityWeights[b.priority] - priorityWeights[a.priority] ||
          b.createdAt - a.createdAt
        );

      case "alphabet":
        return a.text.localeCompare(b.text, "ru");

      default:
        return b.createdAt - a.createdAt;
    }
  });

  return visible;
}

searchInput.addEventListener("input", render);
sortSelect.addEventListener("change", render);

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    render();
  });
});

// ---------- Построение списка ----------

function makeBadge(text, extraClass = "") {
  const badge = document.createElement("span");
  badge.className = `badge ${extraClass}`.trim();
  badge.textContent = text;

  return badge;
}

function makeButton(text, className, accessibleLabel, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = text;
  button.setAttribute("aria-label", accessibleLabel);
  button.addEventListener("click", handler);

  return button;
}

function focusTaskCheckbox(id) {
  const checkbox = document.getElementById(`task-${id}`);

  if (checkbox) {
    checkbox.focus();
  } else {
    searchInput.focus();
  }
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
    const nextTasks = tasks.map(current =>
      current.id === task.id
        ? { ...current, completed: checkbox.checked }
        : current
    );

    commitChange(
      nextTasks,
      checkbox.checked ? "Задача выполнена." : "Задача снова активна."
    );

    focusTaskCheckbox(task.id);
  });

  const content = document.createElement("div");
  content.className = "task-content";

  const title = document.createElement("label");
  title.className = "task-title";
  title.htmlFor = checkbox.id;
  title.textContent = task.text;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  meta.append(
    makeBadge(
      priorityLabels[task.priority],
      `priority-${task.priority}`
    )
  );

  if (task.dueDate) {
    const overdue = isOverdue(task, today);

    meta.append(
      makeBadge(
        `${overdue ? "Просрочено" : "Срок"}: ${formatDate(task.dueDate)}`,
        overdue ? "overdue" : ""
      )
    );
  }

  if (task.completed) {
    meta.append(makeBadge("Выполнено", "done-badge"));
  }

  content.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "task-actions";

  const editButton = makeButton(
    "Изменить",
    "button-secondary",
    `Редактировать задачу: ${task.text}`,
    () => openEditor(task.id)
  );

  const deleteButton = makeButton(
    "Удалить",
    "button-danger",
    `Удалить задачу: ${task.text}`,
    () => {
      commitChange(
        tasks.filter(current => current.id !== task.id),
        "Задача удалена. Можно отменить последнее изменение."
      );

      undoButton.focus();
    }
  );

  actions.append(editButton, deleteButton);
  item.append(checkbox, content, actions);

  return item;
}

function render() {
  const visible = getVisibleTasks();
  const today = getToday();

  const completed = tasks.filter(task => task.completed).length;
  const active = tasks.length - completed;
  const overdue = tasks.filter(task => isOverdue(task, today)).length;

  const percent = tasks.length === 0
    ? 0
    : Math.round((completed / tasks.length) * 100);

  $("#total-count").textContent = tasks.length;
  $("#active-count").textContent = active;
  $("#completed-count").textContent = completed;
  $("#overdue-count").textContent = overdue;
  $("#results-count").textContent = `Показано: ${visible.length}`;

  $("#progress-text").textContent = `${percent}%`;
  $("#progress-bar").value = percent;
  $("#progress-bar").textContent = `${percent}%`;
  $("#progress-bar").setAttribute("aria-label", `Выполнено ${percent}% задач`);

  $("#task-counter").textContent =
    `Осталось задач: ${active}. Выполнено: ${completed} из ${tasks.length}.`;

  filterButtons.forEach(button => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.filter === currentFilter)
    );
  });

  const fragment = document.createDocumentFragment();

  visible.forEach(task => {
    fragment.append(createTaskElement(task, today));
  });

  list.replaceChildren(fragment);

  emptyState.hidden = visible.length > 0;

  if (tasks.length === 0) {
    emptyTitle.textContent = "Здесь начнётся твой план";
    emptyDescription.textContent = "Добавь первую задачу в форме выше.";
  } else if (searchInput.value.trim()) {
    emptyTitle.textContent = "Ничего не найдено";
    emptyDescription.textContent =
      "Попробуй другой запрос или переключи фильтр.";
  } else {
    const messages = {
      all: "Здесь пока нет задач",
      active: "Всё сделано!",
      completed: "Пока нет выполненных задач",
      overdue: "Просроченных задач нет"
    };

    emptyTitle.textContent = messages[currentFilter];
    emptyDescription.textContent =
      "Можно выбрать другой фильтр или добавить новую задачу.";
  }

  clearButton.disabled = completed === 0;
  clearButton.textContent = `Удалить выполненные (${completed})`;

  toggleVisibleButton.disabled = visible.length === 0;

  const allVisibleCompleted =
    visible.length > 0 && visible.every(task => task.completed);

  toggleVisibleButton.textContent = allVisibleCompleted
    ? "Вернуть показанные в активные"
    : "Выполнить показанные";

  undoButton.disabled = undoSnapshot === null;
}

// ---------- Добавление ----------

form.addEventListener("submit", event => {
  event.preventDefault();

  const text = input.value.trim();

  if (!text) {
    notify("Введи текст задачи, а не только пробелы.", true);
    input.focus();
    return;
  }

  if (tasks.length >= maxTasks) {
    notify(`Достигнут лимит: ${maxTasks} задач. Удали ненужные.`, true);
    return;
  }

  if (!isValidDate(dateInput.value)) {
    notify("Проверь срок выполнения задачи.", true);
    dateInput.focus();
    return;
  }

  const task = {
    id: crypto.randomUUID(),
    text,
    completed: false,
    dueDate: dateInput.value,
    priority: priorityInput.value,
    createdAt: Date.now()
  };

  // Новая задача не должна исчезать из-за поиска или фильтра.
  currentFilter = "all";
  searchInput.value = "";

  commitChange([...tasks, task], "Задача добавлена.");

  form.reset();
  input.focus();
});

// ---------- Редактирование ----------

function openEditor(id) {
  const task = tasks.find(current => current.id === id);

  if (!task) {
    return;
  }

  editingId = id;
  editText.value = task.text;
  editDate.value = task.dueDate;
  editPriority.value = task.priority;

  editDialog.showModal();
  editText.focus();
}

$("#close-edit").addEventListener("click", () => editDialog.close());
$("#cancel-edit").addEventListener("click", () => editDialog.close());

editDialog.addEventListener("close", () => {
  const previousId = editingId;
  editingId = null;

  if (previousId) {
    focusTaskCheckbox(previousId);
  }
});

editForm.addEventListener("submit", event => {
  event.preventDefault();

  const text = editText.value.trim();

  if (!text) {
    editText.setCustomValidity("Введи текст задачи.");
    editText.reportValidity();
    return;
  }

  if (!isValidDate(editDate.value)) {
    editDate.setCustomValidity("Проверь дату.");
    editDate.reportValidity();
    return;
  }

  const nextTasks = tasks.map(task =>
    task.id === editingId
      ? {
          ...task,
          text,
          dueDate: editDate.value,
          priority: editPriority.value
        }
      : task
  );

  commitChange(nextTasks, "Изменения задачи сохранены.");
  editDialog.close();
});

editText.addEventListener("input", () => editText.setCustomValidity(""));
editDate.addEventListener("input", () => editDate.setCustomValidity(""));

// ---------- Массовые действия и отмена ----------

toggleVisibleButton.addEventListener("click", () => {
  const visible = getVisibleTasks();

  if (visible.length === 0) {
    return;
  }

  const ids = new Set(visible.map(task => task.id));
  const nextCompleted = !visible.every(task => task.completed);

  const nextTasks = tasks.map(task =>
    ids.has(task.id)
      ? { ...task, completed: nextCompleted }
      : task
  );

  commitChange(nextTasks, `Обновлено задач: ${visible.length}.`);
});

clearButton.addEventListener("click", () => {
  const count = tasks.filter(task => task.completed).length;

  if (count === 0) {
    return;
  }

  const confirmed = confirm(
    `Удалить все выполненные задачи (${count})?\n` +
    "Это касается всего списка, а не только текущего фильтра."
  );

  if (!confirmed) {
    return;
  }

  commitChange(
    tasks.filter(task => !task.completed),
    `Удалено выполненных задач: ${count}. Можно отменить.`
  );

  undoButton.focus();
});

undoButton.addEventListener("click", () => {
  if (undoSnapshot === null) {
    return;
  }

  tasks = cloneTasks(undoSnapshot);
  undoSnapshot = null;

  const saved = saveTasks();
  render();

  if (saved) {
    notify("Последнее изменение отменено.");
  }

  input.focus();
});

// ---------- Экспорт ----------

$("#export-button").addEventListener("click", () => {
  const backup = {
    version: 1,
    exportedAt: new Date().toISOString(),
    tasks: cloneTasks(tasks)
  };

  const blob = new Blob(
    [JSON.stringify(backup, null, 2)],
    { type: "application/json;charset=utf-8" }
  );

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `my-tasks-${getToday()}.json`;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);

  notify("Файл подготовлен. Проверь загрузки браузера.");
});

// ---------- Импорт ----------

$("#import-button").addEventListener("click", () => {
  importFile.click();
});

function validateImportedTasks(data) {
  const source = Array.isArray(data) ? data : data?.tasks;

  if (!Array.isArray(source)) {
    throw new Error("В файле не найден список задач.");
  }

  if (source.length === 0) {
    throw new Error("В файле нет задач для загрузки.");
  }

  if (source.length + tasks.length > maxTasks) {
    throw new Error(`После импорта будет больше ${maxTasks} задач.`);
  }

  return source.map((task, index) => {
    if (
      !task ||
      typeof task.text !== "string" ||
      !task.text.trim() ||
      task.text.trim().length > 200 ||
      typeof task.completed !== "boolean"
    ) {
      throw new Error(`Неверный формат задачи №${index + 1}.`);
    }

    const dueDate = task.dueDate ?? "";
    const priority = task.priority ?? "normal";

    if (!isValidDate(dueDate) || !isValidPriority(priority)) {
      throw new Error(
        `Некорректная дата или приоритет у задачи №${index + 1}.`
      );
    }

    return {
      id: crypto.randomUUID(),
      text: task.text.trim(),
      completed: task.completed,
      dueDate,
      priority,
      createdAt:
        Number.isFinite(task.createdAt) && task.createdAt >= 0
          ? task.createdAt
          : Date.now() + index
    };
  });
}

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];

  if (!file) {
    return;
  }

  try {
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("Файл слишком большой. Максимум — 2 МБ.");
    }

    const text = await file.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch {
      throw new Error("Не удалось прочитать JSON. Проверь файл.");
    }

    const imported = validateImportedTasks(data);

    const confirmed = confirm(
      `Добавить задач из файла: ${imported.length}?\n` +
      "Текущие задачи останутся. Повторный импорт создаст копии."
    );

    if (!confirmed) {
      return;
    }

    currentFilter = "all";
    searchInput.value = "";

    commitChange(
      [...tasks, ...imported],
      `Загружено задач: ${imported.length}. Импорт можно отменить.`
    );
  } catch (error) {
    notify(
      error instanceof Error ? error.message : "Не удалось загрузить файл.",
      true
    );
  } finally {
    importFile.value = "";
  }
});

// ---------- Горячие клавиши ----------

document.addEventListener("keydown", event => {
  if (event.isComposing || editDialog.open) {
    return;
  }

  const target = event.target;
  const isTyping =
    target instanceof HTMLElement &&
    (
      target.matches("input, textarea, select") ||
      target.isContentEditable
    );

  if (
    event.key === "/" &&
    !isTyping &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    searchInput.focus();
    return;
  }

  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  ) {
    event.preventDefault();

    if (input.value.trim()) {
      form.requestSubmit();
    } else {
      input.focus();
    }
  }

  if (event.key === "Escape" && target === searchInput) {
    searchInput.value = "";
    render();
  }
});

// Пересчитываем просрочку при возвращении на вкладку.
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !editDialog.open) {
    render();
  }
});
