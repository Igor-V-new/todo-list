"use strict";

const $ = selector => document.querySelector(selector);

const STORAGE_KEY = "my-todo-tasks";
const THEME_KEY = "my-todo-theme";
const DRAFT_KEY = "my-todo-draft";
const MAX_TASKS = 5000;
const HISTORY_LIMIT = 30;

const priorities = {
  normal: "Обычный",
  important: "Важный",
  urgent: "Срочный"
};

const categories = {
  personal: "Личное",
  work: "Работа",
  study: "Учёба",
  home: "Дом",
  health: "Здоровье",
  other: "Другое"
};

const repeats = {
  none: "Не повторять",
  daily: "Каждый день",
  weekly: "Каждую неделю",
  monthly: "Каждый месяц"
};

const priorityWeight = {
  normal: 1,
  important: 2,
  urgent: 3
};

const form = $("#task-form");
const list = $("#task-list");
const searchInput = $("#search-input");
const sortSelect = $("#sort-select");
const categoryFilter = $("#category-filter");
const filterButtons = document.querySelectorAll("[data-filter]");
const editDialog = $("#edit-dialog");
const importFile = $("#import-file");

let currentFilter = "all";
let focusMode = false;
let editingId = null;
let selected = new Set();
let undoStack = [];
let redoStack = [];
let storageBlocked = false;
let tasks = loadTasks();

initializeTheme();
restoreDraft();
render();

// ---------- Общие функции ----------

function notify(message, error = false) {
  const element = $("#status-message");
  element.textContent = message;
  element.classList.toggle("error", error);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hasKey(object, key) {
  return typeof key === "string" && Object.hasOwn(object, key);
}

function today() {
  return localDate(new Date());
}

function localDate(date) {
  return [
    String(date.getFullYear()).padStart(4, "0"),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function validDate(value) {
  if (value === "") return true;

  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value)
  ) {
    return false;
  }

  const [year, month, day] = value.split("-").map(Number);

  if (year < 1 || year > 9999) return false;

  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function parseDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return date;
}

function addDays(value, days) {
  const date = parseDate(value);
  date.setDate(date.getDate() + days);

  const result = localDate(date);

  if (!validDate(result)) {
    throw new Error("Дата выходит за допустимый диапазон.");
  }

  return result;
}

function nextRepeatDate(value, repeat) {
  if (repeat === "daily") return addDays(value, 1);
  if (repeat === "weekly") return addDays(value, 7);

  const date = parseDate(value);
  const originalDay = date.getDate();

  date.setDate(1);
  date.setMonth(date.getMonth() + 1);

  const lastDay = new Date(date.getTime());
  lastDay.setMonth(lastDay.getMonth() + 1);
  lastDay.setDate(0);

  date.setDate(Math.min(originalDay, lastDay.getDate()));

  const result = localDate(date);

  if (!validDate(result)) {
    throw new Error("Следующий срок выходит за допустимый диапазон.");
  }

  return result;
}

function formatDate(value) {
  return value.split("-").reverse().join(".");
}

function overdue(task, currentDay = today()) {
  return (
    !task.completed &&
    !task.archived &&
    Boolean(task.dueDate) &&
    task.dueDate < currentDay
  );
}

// ---------- Проверка и совместимость сохранений ----------

function normalizeTask(raw, index, strict = false) {
  if (
    !raw ||
    typeof raw.text !== "string" ||
    !raw.text.trim() ||
    raw.text.length > 200 ||
    typeof raw.completed !== "boolean"
  ) {
    throw new Error(`Некорректная задача №${index + 1}.`);
  }

  const dueDate = raw.dueDate ?? "";
  const priority = raw.priority ?? "normal";
  const category = raw.category ?? "personal";
  const repeat = raw.repeat ?? "none";
  const notes = raw.notes ?? "";
  const subtasks = raw.subtasks ?? [];

  if (
    !validDate(dueDate) ||
    !hasKey(priorities, priority) ||
    !hasKey(categories, category) ||
    !hasKey(repeats, repeat) ||
    typeof notes !== "string" ||
    notes.length > 3000 ||
    !Array.isArray(subtasks) ||
    subtasks.length > 30
  ) {
    throw new Error(`Неверные поля задачи №${index + 1}.`);
  }

  if (repeat !== "none" && !dueDate) {
    throw new Error(`Для повторения задачи №${index + 1} нужен срок.`);
  }

  const cleanSubtasks = subtasks.map(subtask => {
    if (
      !subtask ||
      typeof subtask.text !== "string" ||
      !subtask.text.trim() ||
      subtask.text.length > 200 ||
      typeof subtask.completed !== "boolean"
    ) {
      throw new Error(`Некорректная подзадача у задачи №${index + 1}.`);
    }

    return {
      text: subtask.text.trim(),
      completed: subtask.completed
    };
  });

  return {
    id:
      !strict && typeof raw.id === "string" && raw.id
        ? raw.id
        : crypto.randomUUID(),
    text: raw.text.trim(),
    completed: raw.completed,
    dueDate,
    priority,
    category,
    repeat,
    notes,
    subtasks: cleanSubtasks,
    pinned: raw.pinned === true,
    archived: raw.archived === true,
    repeatCreated: raw.repeatCreated === true,
    createdAt:
      Number.isFinite(raw.createdAt) && raw.createdAt >= 0
        ? raw.createdAt
        : index
  };
}

function loadTasks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw === null) return [];

    const saved = JSON.parse(raw);

    if (!Array.isArray(saved) || saved.length > MAX_TASKS) {
      throw new Error("Некорректный список.");
    }

    const ids = new Set();

    return saved.map((task, index) => {
      const normalized = normalizeTask(task, index);

      if (ids.has(normalized.id)) {
        normalized.id = crypto.randomUUID();
      }

      ids.add(normalized.id);
      return normalized;
    });
  } catch {
    storageBlocked = true;

    notify(
      "Не удалось прочитать сохранение. Изменения заблокированы, " +
      "чтобы не перезаписать старые данные. Скачай JSON и проверь его.",
      true
    );

    return [];
  }
}

function persist(nextTasks) {
  if (storageBlocked) {
    notify(
      "Сохранение заблокировано из-за ошибки чтения старых данных.",
      true
    );
    return false;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextTasks));
    return true;
  } catch {
    notify(
      "Браузер не смог сохранить изменения. Действие не применено. " +
      "Проверь свободное место и настройки хранилища.",
      true
    );
    return false;
  }
}

function commit(nextTasks, message) {
  if (nextTasks.length > MAX_TASKS) {
    notify(`Максимум — ${MAX_TASKS} задач.`, true);
    return false;
  }

  if (!persist(nextTasks)) return false;

  undoStack.push(clone(tasks));

  if (undoStack.length > HISTORY_LIMIT) {
    undoStack.shift();
  }

  redoStack = [];
  tasks = nextTasks;

  render();
  notify(message);

  return true;
}

function updateTask(id, change, message) {
  return commit(
    tasks.map(task => task.id === id ? change(clone(task)) : task),
    message
  );
}

// ---------- Тема ----------

function initializeTheme() {
  let theme = matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";

  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") theme = saved;
  } catch {
    // Тема работает без сохранения.
  }

  applyTheme(theme);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").textContent =
    theme === "dark" ? "Светлая тема" : "Тёмная тема";
}

$("#theme-toggle").addEventListener("click", () => {
  const theme = document.documentElement.dataset.theme === "dark"
    ? "light"
    : "dark";

  applyTheme(theme);

  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    notify("Не удалось сохранить выбор темы.", true);
  }
});

// ---------- Черновик и поля форм ----------

function parseSubtasks(text, previous = []) {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);

  if (lines.length > 30 || lines.some(line => line.length > 200)) {
    throw new Error("Максимум 30 подзадач, каждая до 200 символов.");
  }

  const remaining = previous.map(item => ({ ...item }));

  return lines.map(text => {
    const index = remaining.findIndex(item => item.text === text);
    const old = index >= 0 ? remaining.splice(index, 1)[0] : null;

    return {
      text,
      completed: old ? old.completed : false
    };
  });
}

function readFields(prefix, previousSubtasks = []) {
  const text = $(`#${prefix}-text`)?.value.trim() ??
    $("#task-input").value.trim();

  const dueDate = $(`#${prefix}-date`).value;
  const repeat = $(`#${prefix}-repeat`).value;

  if (!text || text.length > 200) {
    throw new Error("Название должно содержать от 1 до 200 символов.");
  }

  if (!validDate(dueDate)) {
    throw new Error("Проверь срок выполнения.");
  }

  if (repeat !== "none" && !dueDate) {
    throw new Error("Для повторяющейся задачи укажи срок.");
  }

  return {
    text,
    dueDate,
    repeat,
    priority: $(`#${prefix}-priority`).value,
    category: $(`#${prefix}-category`).value,
    notes: $(`#${prefix}-notes`).value.trim(),
    subtasks: parseSubtasks(
      $(`#${prefix}-subtasks`).value,
      previousSubtasks
    )
  };
}

const draftFields = [
  "task-input",
  "task-date",
  "task-priority",
  "task-category",
  "task-repeat",
  "task-notes",
  "task-subtasks"
];

function saveDraft() {
  try {
    const draft = {};

    draftFields.forEach(id => {
      draft[id] = document.getElementById(id).value;
    });

    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    $("#draft-status").textContent = "Черновик сохранён";
  } catch {
    $("#draft-status").textContent = "Черновик не сохранён";
  }
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY));

    if (!draft || typeof draft !== "object") return;

    draftFields.forEach(id => {
      if (typeof draft[id] === "string") {
        document.getElementById(id).value = draft[id];
      }
    });

    $("#draft-status").textContent = "Черновик восстановлен";
  } catch {
    // Ошибка черновика не влияет на сохранённые задачи.
  }
}

form.addEventListener("input", saveDraft);
form.addEventListener("change", saveDraft);

form.addEventListener("submit", event => {
  event.preventDefault();

  try {
    const fields = readFields("task");

    const task = {
      ...fields,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      completed: false,
      pinned: false,
      archived: false,
      repeatCreated: false
    };

    if (!commit([...tasks, task], "Задача добавлена.")) return;

    currentFilter = "all";
    categoryFilter.value = "all";
    searchInput.value = "";
    focusMode = false;
    selected.clear();

    form.reset();

    try {
      localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Основная задача уже сохранена.
    }

    $("#draft-status").textContent = "";
    render();
    $("#task-input").focus();
  } catch (error) {
    notify(error.message, true);
  }
});

// ---------- Фильтры и сортировка ----------

function visibleTasks() {
  const query = searchInput.value.trim().toLocaleLowerCase("ru");
  const currentDay = today();
  const weekEnd = addDays(currentDay, 6);

  let result = tasks.filter(task => {
    if (currentFilter === "archived") {
      if (!task.archived) return false;
    } else if (task.archived) {
      return false;
    }

    if (
      categoryFilter.value !== "all" &&
      task.category !== categoryFilter.value
    ) {
      return false;
    }

    const searchText = [
      task.text,
      task.notes,
      ...task.subtasks.map(item => item.text)
    ].join(" ").toLocaleLowerCase("ru");

    if (!searchText.includes(query)) return false;

    switch (currentFilter) {
      case "active":
        return !task.completed;
      case "completed":
        return task.completed;
      case "overdue":
        return overdue(task, currentDay);
      case "today":
        return !task.completed && task.dueDate === currentDay;
      case "week":
        return (
          !task.completed &&
          Boolean(task.dueDate) &&
          task.dueDate >= currentDay &&
          task.dueDate <= weekEnd
        );
      default:
        return true;
    }
  });

  result.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return Number(b.pinned) - Number(a.pinned);
    }

    switch (sortSelect.value) {
      case "oldest":
        return a.createdAt - b.createdAt;
      case "deadline":
        return (
          (a.dueDate || "9999-99-99").localeCompare(
            b.dueDate || "9999-99-99"
          ) ||
          b.createdAt - a.createdAt
        );
      case "priority":
        return (
          priorityWeight[b.priority] - priorityWeight[a.priority] ||
          b.createdAt - a.createdAt
        );
      case "alphabet":
        return a.text.localeCompare(b.text, "ru");
      default:
        return b.createdAt - a.createdAt;
    }
  });

  if (focusMode) {
    result = result.filter(task => !task.completed && !task.archived).slice(0, 1);
  }

  return result;
}

function changeView() {
  selected.clear();
  render();
}

searchInput.addEventListener("input", changeView);
categoryFilter.addEventListener("change", changeView);
sortSelect.addEventListener("change", changeView);

filterButtons.forEach(button => {
  button.addEventListener("click", () => {
    currentFilter = button.dataset.filter;
    changeView();
  });
});

$("#focus-toggle").addEventListener("click", () => {
  focusMode = !focusMode;

  if (focusMode) {
    currentFilter = "active";
  }

  changeView();
});

// ---------- Выполнение и повторяющиеся задачи ----------

function changeCompletion(ids, completed) {
  const next = clone(tasks);
  const generated = [];

  next.forEach(task => {
    if (!ids.has(task.id)) return;

    const firstCompletion = completed && !task.completed;
    task.completed = completed;

    if (
      firstCompletion &&
      task.repeat !== "none" &&
      task.dueDate &&
      !task.repeatCreated &&
      !task.archived
    ) {
      const nextTask = {
        ...clone(task),
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        dueDate: nextRepeatDate(task.dueDate, task.repeat),
        completed: false,
        archived: false,
        repeatCreated: false,
        subtasks: task.subtasks.map(item => ({
          text: item.text,
          completed: false
        }))
      };

      generated.push(nextTask);
      task.repeatCreated = true;
    }
  });

  return [...next, ...generated];
}

function completeIds(ids, completed) {
  try {
    commit(
      changeCompletion(ids, completed),
      completed
        ? "Задачи выполнены. Следующие повторения созданы при необходимости."
        : "Задачи возвращены в активные."
    );
  } catch (error) {
    notify(error.message, true);
    render();
  }
}

// ---------- Построение интерфейса ----------

function badge(text, className = "") {
  const element = document.createElement("span");
  element.className = `badge ${className}`.trim();
  element.textContent = text;
  return element;
}

function action(text, label, handler, className = "secondary") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `button ${className}`;
  button.textContent = text;
  button.setAttribute("aria-label", label);
  button.addEventListener("click", handler);
  return button;
}

function focusCheckbox(id) {
  const element = document.getElementById(`complete-${id}`);

  if (element) {
    element.focus();
  } else {
    $("#focus-toggle").focus();
  }
}

function createTaskElement(task, currentDay) {
  const item = document.createElement("li");
  item.className = [
    "task",
    task.completed ? "completed" : "",
    selected.has(task.id) ? "selected" : ""
  ].filter(Boolean).join(" ");

  const checks = document.createElement("div");
  checks.className = "task-checks";

  const select = document.createElement("input");
  select.type = "checkbox";
  select.className = "task-select";
  select.checked = selected.has(task.id);
  select.setAttribute("aria-label", `Выбрать задачу: ${task.text}`);

  select.addEventListener("change", () => {
    if (select.checked) {
      selected.add(task.id);
    } else {
      selected.delete(task.id);
    }

    item.classList.toggle("selected", select.checked);
    renderSelection(visibleTasks());
  });

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.id = `complete-${task.id}`;
  checkbox.checked = task.completed;

  checkbox.addEventListener("change", () => {
    completeIds(new Set([task.id]), checkbox.checked);
    focusCheckbox(task.id);
  });

  checks.append(select, checkbox);

  const content = document.createElement("div");
  content.className = "task-content";

  const title = document.createElement("label");
  title.className = "task-title";
  title.htmlFor = checkbox.id;
  title.textContent = task.text;

  const meta = document.createElement("div");
  meta.className = "task-meta";

  if (task.pinned) meta.append(badge("Закреплено", "pinned"));

  meta.append(
    badge(categories[task.category]),
    badge(priorities[task.priority], `priority-${task.priority}`)
  );

  if (task.dueDate) {
    const late = overdue(task, currentDay);
    meta.append(
      badge(
        `${late ? "Просрочено" : "Срок"}: ${formatDate(task.dueDate)}`,
        late ? "overdue" : ""
      )
    );
  }

  if (task.repeat !== "none") {
    meta.append(badge(repeats[task.repeat]));
  }

  if (task.completed) meta.append(badge("Выполнено", "done"));
  if (task.archived) meta.append(badge("В архиве"));

  content.append(title, meta);

  if (task.notes) {
    const notes = document.createElement("p");
    notes.className = "task-notes";
    notes.textContent = task.notes;
    content.append(notes);
  }

  if (task.subtasks.length) {
    const checklist = document.createElement("ul");
    checklist.className = "subtasks";

    task.subtasks.forEach((subtask, index) => {
      const row = document.createElement("li");
      const label = document.createElement("label");
      label.className = "subtask-label";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = subtask.completed;
      check.id = `sub-${task.id}-${index}`;

      const text = document.createElement("span");
      text.textContent = subtask.text;
      text.classList.toggle("subtask-done", subtask.completed);

      check.addEventListener("change", () => {
        const id = check.id;

        updateTask(
          task.id,
          current => {
            current.subtasks[index].completed = check.checked;
            return current;
          },
          "Подзадача обновлена."
        );

        document.getElementById(id)?.focus();
      });

      label.append(check, text);
      row.append(label);
      checklist.append(row);
    });

    content.append(checklist);
  }

  const actions = document.createElement("div");
  actions.className = "task-actions";

  actions.append(
    action(
      "Изменить",
      `Редактировать: ${task.text}`,
      () => openEditor(task.id)
    ),
    action(
      task.pinned ? "Открепить" : "Закрепить",
      `${task.pinned ? "Открепить" : "Закрепить"}: ${task.text}`,
      () => updateTask(
        task.id,
        current => ({ ...current, pinned: !current.pinned }),
        "Закрепление изменено."
      )
    ),
    action(
      "Копия",
      `Создать копию: ${task.text}`,
      () => {
        const copy = {
          ...clone(task),
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          completed: false,
          archived: false,
          repeatCreated: false,
          subtasks: task.subtasks.map(subtask => ({
            text: subtask.text,
            completed: false
          }))
        };

        commit([...tasks, copy], "Создана активная копия задачи.");
      }
    )
  );

  if (!task.completed && !task.archived) {
    actions.append(
      action(
        "+1 день",
        `Перенести срок на день: ${task.text}`,
        () => {
          try {
            const base = task.dueDate && task.dueDate > today()
              ? task.dueDate
              : today();

            updateTask(
              task.id,
              current => ({ ...current, dueDate: addDays(base, 1) }),
              "Срок перенесён."
            );
          } catch (error) {
            notify(error.message, true);
          }
        }
      )
    );
  }

  actions.append(
    action(
      task.archived ? "Вернуть" : "В архив",
      `${task.archived ? "Вернуть из архива" : "Архивировать"}: ${task.text}`,
      () => updateTask(
        task.id,
        current => ({ ...current, archived: !current.archived }),
        "Архив обновлён."
      )
    ),
    action(
      "Удалить",
      `Удалить: ${task.text}`,
      () => {
        if (commit(
          tasks.filter(current => current.id !== task.id),
          "Задача удалена. Удаление можно отменить."
        )) {
          $("#undo-button").focus();
        }
      },
      "danger"
    )
  );

  item.append(checks, content, actions);
  return item;
}

function renderSelection(visible) {
  const visibleIds = new Set(visible.map(task => task.id));
  selected = new Set([...selected].filter(id => visibleIds.has(id)));

  const selectAll = $("#select-visible");
  const count = selected.size;

  selectAll.disabled = visible.length === 0;
  selectAll.checked = visible.length > 0 && count === visible.length;
  selectAll.indeterminate = count > 0 && count < visible.length;

  $("#selected-count").textContent = `Выбрано: ${count}`;
  $("#bulk-actions").hidden = count === 0;

  $("#bulk-archive").textContent =
    currentFilter === "archived" ? "Вернуть из архива" : "В архив";
}

function render() {
  const currentDay = today();
  const visible = visibleTasks();
  const outsideArchive = tasks.filter(task => !task.archived);
  const done = outsideArchive.filter(task => task.completed).length;
  const active = outsideArchive.length - done;
  const late = outsideArchive.filter(task => overdue(task, currentDay)).length;
  const percent = outsideArchive.length
    ? Math.round(done / outsideArchive.length * 100)
    : 0;

  $("#total-count").textContent = outsideArchive.length;
  $("#active-count").textContent = active;
  $("#completed-count").textContent = done;
  $("#overdue-count").textContent = late;

  $("#results-count").textContent =
    `Показано: ${visible.length}${focusMode ? " · режим фокуса" : ""}`;

  $("#progress-text").textContent = `${percent}%`;
  $("#progress-bar").value = percent;
  $("#progress-bar").textContent = `${percent}%`;
  $("#progress-bar").setAttribute(
    "aria-label",
    `Выполнено ${percent}% задач вне архива`
  );

  $("#task-counter").textContent =
    `Осталось: ${active}. Выполнено: ${done}. ` +
    `В архиве: ${tasks.length - outsideArchive.length}.`;

  filterButtons.forEach(button => {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.filter === currentFilter)
    );
  });

  $("#focus-toggle").setAttribute("aria-pressed", String(focusMode));
  $("#focus-toggle").textContent =
    focusMode ? "Выйти из фокуса" : "Режим фокуса";

  renderSelection(visible);

  const fragment = document.createDocumentFragment();

  visible.forEach(task => {
    fragment.append(createTaskElement(task, currentDay));
  });

  list.replaceChildren(fragment);

  $("#empty-state").hidden = visible.length > 0;
  $("#empty-title").textContent =
    tasks.length === 0 ? "Здесь начнётся твой план" : "Нет подходящих задач";

  $("#empty-description").textContent = tasks.length === 0
    ? "Добавь первую задачу в форме выше."
    : "Измени поиск, категорию, фильтр или отключи режим фокуса.";

  const allDone = visible.length > 0 &&
    visible.every(task => task.completed);

  $("#toggle-visible").disabled = visible.length === 0 || storageBlocked;
  $("#toggle-visible").textContent =
    allDone ? "Вернуть показанные в активные" : "Выполнить показанные";

  $("#clear-completed").disabled = done === 0 || storageBlocked;
  $("#clear-completed").textContent =
    `Удалить выполненные (${done})`;

  $("#undo-button").disabled = undoStack.length === 0;
  $("#redo-button").disabled = redoStack.length === 0;

  $("#task-form button[type='submit']").disabled = storageBlocked;
}

// ---------- Редактирование ----------

function openEditor(id) {
  const task = tasks.find(item => item.id === id);
  if (!task) return;

  editingId = id;

  $("#edit-text").value = task.text;
  $("#edit-date").value = task.dueDate;
  $("#edit-priority").value = task.priority;
  $("#edit-category").value = task.category;
  $("#edit-repeat").value = task.repeat;
  $("#edit-notes").value = task.notes;
  $("#edit-subtasks").value =
    task.subtasks.map(item => item.text).join("\n");

  editDialog.showModal();
  $("#edit-text").focus();
}

$("#close-edit").addEventListener("click", () => editDialog.close());
$("#cancel-edit").addEventListener("click", () => editDialog.close());

editDialog.addEventListener("close", () => {
  const id = editingId;
  editingId = null;
  if (id) focusCheckbox(id);
});

$("#edit-form").addEventListener("submit", event => {
  event.preventDefault();

  const existing = tasks.find(task => task.id === editingId);
  if (!existing) return;

  try {
    const fields = readFields("edit", existing.subtasks);

    const success = updateTask(
      existing.id,
      task => ({ ...task, ...fields }),
      "Задача обновлена."
    );

    if (success) editDialog.close();
  } catch (error) {
    notify(error.message, true);
    alert(error.message);
  }
});

// ---------- Выделение и массовые действия ----------

$("#select-visible").addEventListener("change", event => {
  selected = event.target.checked
    ? new Set(visibleTasks().map(task => task.id))
    : new Set();

  render();
});

$("#clear-selection").addEventListener("click", () => {
  selected.clear();
  render();
});

$("#bulk-complete").addEventListener("click", () => {
  completeIds(new Set(selected), true);
});

$("#bulk-archive").addEventListener("click", () => {
  const archived = currentFilter !== "archived";

  commit(
    tasks.map(task =>
      selected.has(task.id) ? { ...task, archived } : task
    ),
    archived ? "Выбранные задачи в архиве." : "Задачи возвращены из архива."
  );
});

$("#bulk-delete").addEventListener("click", () => {
  if (!selected.size) return;

  if (!confirm(`Удалить выбранные задачи (${selected.size})?`)) return;

  commit(
    tasks.filter(task => !selected.has(task.id)),
    "Выбранные задачи удалены. Можно отменить."
  );
});

$("#toggle-visible").addEventListener("click", () => {
  const visible = visibleTasks();
  if (!visible.length) return;

  const completed = !visible.every(task => task.completed);
  completeIds(new Set(visible.map(task => task.id)), completed);
});

$("#clear-completed").addEventListener("click", () => {
  const count = tasks.filter(task => task.completed && !task.archived).length;

  if (!count) return;

  if (!confirm(
    `Удалить все выполненные задачи вне архива (${count})?\n` +
    "Поиск и текущий фильтр не ограничивают это действие."
  )) {
    return;
  }

  commit(
    tasks.filter(task => !task.completed || task.archived),
    "Выполненные задачи удалены. Архив не затронут."
  );
});

// ---------- История ----------

$("#undo-button").addEventListener("click", () => {
  if (!undoStack.length) return;

  const previous = undoStack[undoStack.length - 1];
  if (!persist(previous)) return;

  redoStack.push(clone(tasks));
  tasks = undoStack.pop();
  selected.clear();

  render();
  notify("Изменение отменено.");
});

$("#redo-button").addEventListener("click", () => {
  if (!redoStack.length) return;

  const next = redoStack[redoStack.length - 1];
  if (!persist(next)) return;

  undoStack.push(clone(tasks));
  tasks = redoStack.pop();
  selected.clear();

  render();
  notify("Изменение повторено.");
});

// ---------- Экспорт ----------

function download(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.append(link);
  link.click();
  link.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#export-button").addEventListener("click", () => {
  if (storageBlocked) {
    try {
      const original = localStorage.getItem(STORAGE_KEY);

      if (original === null) {
        throw new Error("Сохранение недоступно.");
      }

      download(
        original,
        "application/json;charset=utf-8",
        `tasks-recovery-${today()}.json`
      );

      notify("Скачан исходный файл для восстановления.");
    } catch {
      notify("Не удалось получить исходное сохранение.", true);
    }

    return;
  }

  download(
    JSON.stringify({
      version: 2,
      exportedAt: new Date().toISOString(),
      tasks
    }, null, 2),
    "application/json;charset=utf-8",
    `my-tasks-${today()}.json`
  );

  notify("JSON подготовлен. Включены все задачи и архив.");
});

function csvCell(value) {
  let text = String(value ?? "");

  // Не даём текстовым ячейкам превращаться в формулы таблицы.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) {
    text = "'" + text;
  }

  return `"${text.replace(/"/g, '""')}"`;
}

$("#csv-button").addEventListener("click", () => {
  if (storageBlocked) {
    notify("Сначала нужно восстановить сохранение. Доступен исходный JSON.", true);
    return;
  }

  const rows = [
    [
      "Название",
      "Выполнено",
      "Срок",
      "Приоритет",
      "Категория",
      "Повторение",
      "Заметка",
      "Подзадачи",
      "Закреплено",
      "В архиве"
    ],
    ...tasks.map(task => [
      task.text,
      task.completed ? "Да" : "Нет",
      task.dueDate,
      priorities[task.priority],
      categories[task.category],
      repeats[task.repeat],
      task.notes,
      task.subtasks.map(item =>
        `${item.completed ? "[x]" : "[ ]"} ${item.text}`
      ).join("\n"),
      task.pinned ? "Да" : "Нет",
      task.archived ? "Да" : "Нет"
    ])
  ];

  const csv = "\uFEFF" +
    rows.map(row => row.map(csvCell).join(";")).join("\r\n");

  download(csv, "text/csv;charset=utf-8", `my-tasks-${today()}.csv`);
  notify("CSV подготовлен. Включены все задачи и архив.");
});

// ---------- Импорт ----------

$("#import-button").addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;

  try {
    if (storageBlocked) {
      throw new Error(
        "Импорт заблокирован, чтобы не перезаписать непрочитанное сохранение."
      );
    }

    if (file.size > 100 * 1024 * 1024) {
      throw new Error("Максимальный размер файла — 100 МБ.");
    }

    let data;

    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("Не удалось прочитать JSON-файл.");
    }

    const source = Array.isArray(data) ? data : data?.tasks;

    if (!Array.isArray(source) || !source.length) {
      throw new Error("В файле нет задач.");
    }

    if (source.length + tasks.length > MAX_TASKS) {
      throw new Error(`После импорта будет больше ${MAX_TASKS} задач.`);
    }

    const imported = source.map((task, index) =>
      normalizeTask(task, index, true)
    );

    if (!confirm(
      `Добавить задач: ${imported.length}?\n` +
      "Текущие данные останутся. Повторный импорт создаст копии."
    )) {
      return;
    }

    if (commit([...tasks, ...imported], "Задачи загружены. Импорт можно отменить.")) {
      currentFilter = "all";
      focusMode = false;
      searchInput.value = "";
      categoryFilter.value = "all";
      selected.clear();
      render();
    }
  } catch (error) {
    notify(error.message || "Ошибка импорта.", true);
  } finally {
    importFile.value = "";
  }
});

// ---------- Горячие клавиши ----------

document.addEventListener("keydown", event => {
  if (event.isComposing || editDialog.open) return;

  const target = event.target;
  const typing = target instanceof HTMLElement && (
    target.matches("input, textarea, select") ||
    target.isContentEditable
  );

  if (
    event.key === "/" &&
    !typing &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    event.preventDefault();
    searchInput.focus();
  }

  if (
    event.key === "Enter" &&
    (event.ctrlKey || event.metaKey) &&
    !event.altKey
  ) {
    event.preventDefault();

    if ($("#task-input").value.trim()) {
      form.requestSubmit();
    } else {
      $("#task-input").focus();
    }
  }

  if (event.key === "Escape" && target === searchInput) {
    searchInput.value = "";
    changeView();
  }
});

document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !editDialog.open) {
    render();
  }
});
