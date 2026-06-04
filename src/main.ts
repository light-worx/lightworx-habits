import { 
	Plugin, 
	WorkspaceLeaf, 
	ItemView, 
	TFile,
	PluginSettingTab,
	Setting,
	normalizePath
} from 'obsidian';

const VIEW_TYPE_HABITS = "lightworx-habits-sidebar";

interface HabitsPluginSettings {
	habitsList: string[];
	startDate: string;
}

const DEFAULT_SETTINGS: HabitsPluginSettings = {
	habitsList: ["Workout", "Meditation", "Reading", "Coding"],
	startDate: "2026-01-01"
}

export default class HabitsPlugin extends Plugin {
	settings: HabitsPluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_HABITS,
			(leaf) => new HabitsSidebarView(leaf, this)
		);

		this.addRibbonIcon('calendar-heart', 'Open Habits Tracker', () => {
			this.activateView();
		});

		this.registerMarkdownCodeBlockProcessor("habit-heatmap", (source, el, ctx) => {
			this.renderHeatmap(el);
		});

		this.addSettingTab(new HabitsSettingTab(this.app, this));

		this.registerEvent(this.app.workspace.on('layout-change', () => {
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_HABITS);
			leaves.forEach(leaf => {
				if (leaf.view instanceof HabitsSidebarView) {
					leaf.view.updateView();
				}
			});
		}));
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.app.workspace.trigger("layout-change");
	}

	async activateView() {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE_HABITS)[0];

		if (!leaf) {
			const rightLeaf = workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({ type: VIEW_TYPE_HABITS, active: true });
				leaf = rightLeaf;
			}
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	/**
	 * Returns the vault path for a given moment date object.
	 */
	getNotePathForDate(momentDate: any): string {
		let format = "YYYY-MM-DD";
		let folder = "";

		const dailyNotesSetting = (this.app as any).internalPlugins?.plugins?.["daily-notes"]?.instance?.options;
		if (dailyNotesSetting) {
			format = dailyNotesSetting.format || format;
			folder = dailyNotesSetting.folder || folder;
		}

		const fileName = momentDate.format(format) + ".md";
		return normalizePath(folder ? `${folder}/${fileName}` : fileName);
	}

	/**
	 * Convenience: path for today's daily note.
	 */
	getTodayNotePath(): string {
		const moment = (window as any).moment;
		return this.getNotePathForDate(moment());
	}

	/**
	 * Calculate the current streak for a given habit key (e.g. "habit-workout").
	 * Walks backwards from today counting consecutive completed days.
	 */
	getStreak(key: string): number {
		const moment = (window as any).moment;
		const files = this.app.vault.getMarkdownFiles();
		const dailyNotesSetting = (this.app as any).internalPlugins?.plugins?.["daily-notes"]?.instance?.options;
		const format = dailyNotesSetting?.format || "YYYY-MM-DD";

		let streak = 0;
		let current = moment().startOf('day');

		while (true) {
			const baseName = current.format(format);
			const file = files.find(f => f.basename === baseName);
			if (!file) break;
			const cache = this.app.metadataCache.getFileCache(file);
			if (cache?.frontmatter?.[key] === true) {
				streak++;
				current.subtract(1, 'day');
			} else {
				break;
			}
		}
		return streak;
	}

	renderHeatmap(el: HTMLElement) {
		el.empty();
		const container = el.createDiv({ cls: "habit-matrix-container" });
		container.createEl("span");

		const moment = (window as any).moment;
		const start = moment(this.settings.startDate, "YYYY-MM-DD");
		const today = moment().startOf('day');
		const files = this.app.vault.getMarkdownFiles();
		const dailyNotesSetting = (this.app as any).internalPlugins?.plugins?.["daily-notes"]?.instance?.options;
		const format = dailyNotesSetting?.format || "YYYY-MM-DD";

		this.settings.habitsList.forEach(habit => {
			const row = container.createDiv({ cls: "matrix-row" });
			row.createDiv({ cls: "matrix-label", text: habit });
			
			const grid = row.createDiv({ cls: "matrix-grid" });
			const key = `habit-${habit.toLowerCase().replace(/\s+/g, '-')}`;

			let currentDay = start.clone();
			while (currentDay.isSameOrBefore(today, 'day')) {
				const expectedBaseName = currentDay.format(format);
				const dayFile = files.find(f => f.basename === expectedBaseName);
				
				let completed = false;
				if (dayFile) {
					const cache = this.app.metadataCache.getFileCache(dayFile);
					completed = cache?.frontmatter?.[key] === true;
				}

				grid.createDiv({ 
					cls: `matrix-day ${completed ? 'completed' : 'empty'}`,
					attr: { title: `${habit} - ${currentDay.format("YYYY-MM-DD")}: ${completed ? 'Done' : 'Missed'}` }
				});

				currentDay.add(1, 'day');
			}
		});
	}
}

/**
 * Settings Tab
 */
class HabitsSettingTab extends PluginSettingTab {
	plugin: HabitsPlugin;

	constructor(app: any, plugin: HabitsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Habit Tracker Settings' });

		new Setting(containerEl)
			.setName('Start Date')
			.setDesc('Track and visualize historical daily notes beginning from this date (YYYY-MM-DD)')
			.addText(text => text
				.setPlaceholder('2026-01-01')
				.setValue(this.plugin.settings.startDate)
				.onChange(async (value) => {
					this.plugin.settings.startDate = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Tracked Habits')
			.setDesc('Comma-separated list of habits you want to track (e.g. Workout, Meditation, Reading)')
			.addTextArea(text => text
				.setPlaceholder('Workout, Meditation, Reading')
				.setValue(this.plugin.settings.habitsList.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.habitsList = value
						.split(',')
						.map(h => h.trim())
						.filter(h => h.length > 0);
					await this.plugin.saveSettings();
				}));
	}
}

/**
 * Sidebar View — with date navigation
 */
class HabitsSidebarView extends ItemView {
	plugin: HabitsPlugin;
	/** Offset in days from today. 0 = today, -1 = yesterday, etc. */
	private dayOffset: number = 0;

	constructor(leaf: WorkspaceLeaf, plugin: HabitsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string { return VIEW_TYPE_HABITS; }
	getDisplayText(): string { return "Habits Panel"; }
	getIcon(): string { return "calendar-heart"; }

	async onOpen() { this.updateView(); }

	/**
	 * Returns a moment object for the currently viewed date.
	 */
	private getViewedDate() {
		const moment = (window as any).moment;
		return moment().startOf('day').add(this.dayOffset, 'days');
	}

	async updateView() {
		const container = this.contentEl;
		container.empty();
		container.addClass("lightworx-habits-sidebar-container");

		const moment = (window as any).moment;
		const viewedDate = this.getViewedDate();
		const isToday = this.dayOffset === 0;
		const isFuture = this.dayOffset > 0;

		// ── Header with navigation ────────────────────────────────────────────
		const header = container.createDiv({ cls: "habits-header" });

		const prevBtn = header.createEl("button", { cls: "habits-nav-btn", attr: { "aria-label": "Previous day" } });
		prevBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>`;
		prevBtn.addEventListener("click", () => { this.dayOffset--; this.updateView(); });

		const dateInfo = header.createDiv({ cls: "habits-date-info" });
		
		// Primary label
		let label: string;
		if (isToday) label = "Today";
		else if (this.dayOffset === -1) label = "Yesterday";
		else if (this.dayOffset === 1) label = "Tomorrow";
		else label = viewedDate.format("ddd, D MMM");
		
		dateInfo.createEl("span", { cls: "habits-date-label", text: label });
		dateInfo.createEl("span", { cls: "habits-date-sub", text: viewedDate.format("YYYY-MM-DD") });

		// Jump-to-today button (only visible when not on today)
		if (!isToday) {
			const todayBtn = header.createEl("button", { cls: "habits-today-btn", text: "Today", attr: { "aria-label": "Jump to today" } });
			todayBtn.addEventListener("click", () => { this.dayOffset = 0; this.updateView(); });
		} else {
			// Placeholder to keep layout stable
			header.createEl("button", { cls: "habits-today-btn habits-today-btn--hidden", text: "Today" });
		}

		const nextBtn = header.createEl("button", { cls: `habits-nav-btn ${isToday ? 'habits-nav-btn--disabled' : ''}`, attr: { "aria-label": "Next day" } });
		nextBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>`;
		if (isToday) {
			nextBtn.setAttribute("disabled", "true");
		} else {
			nextBtn.addEventListener("click", () => { this.dayOffset++; this.updateView(); });
		}

		// ── Divider ───────────────────────────────────────────────────────────
		container.createDiv({ cls: "habits-divider" });

		// ── Future date guard ─────────────────────────────────────────────────
		if (isFuture) {
			container.createDiv({ cls: "habit-notice", text: "You can't log habits for future dates." });
			return;
		}

		// ── Resolve the daily note for the viewed date ────────────────────────
		const notePath = this.plugin.getNotePathForDate(viewedDate);
		const file = this.app.vault.getAbstractFileByPath(notePath);

		let frontmatter: Record<string, any> = {};
		if (file && file instanceof TFile) {
			const cache = this.app.metadataCache.getFileCache(file);
			frontmatter = cache?.frontmatter || {};
		} else {
			const dateLabel = isToday ? "today" : viewedDate.format("YYYY-MM-DD");
			container.createDiv({ cls: "habit-notice", text: `No daily note found for ${dateLabel}.` });
			const createBtn = container.createEl("button", { cls: "habits-create-btn", text: `Create Note` });
			createBtn.addEventListener("click", async () => {
				await this.app.vault.create(notePath, "---\n---\n");
				this.updateView();
			});
			return;
		}

		if (this.plugin.settings.habitsList.length === 0) {
			container.createDiv({ cls: "habit-notice", text: "Go to settings to add habits to track!" });
			return;
		}

		// ── Habit rows ────────────────────────────────────────────────────────
		const list = container.createDiv({ cls: "habits-list" });

		this.plugin.settings.habitsList.forEach(habit => {
			const key = `habit-${habit.toLowerCase().replace(/\s+/g, '-')}`;
			const isChecked = frontmatter[key] === true;
			const streak = this.plugin.getStreak(key);

			const row = list.createDiv({ cls: `habit-row ${isChecked ? 'habit-row--checked' : ''}` });

			// Custom checkbox
			const checkWrap = row.createDiv({ cls: "habit-check-wrap" });
			const checkbox = checkWrap.createEl("input", { type: "checkbox", cls: "habit-checkbox" });
			checkbox.id = `habit-cb-${key}`;
			checkbox.checked = isChecked;

			const checkVisual = checkWrap.createDiv({ cls: "habit-check-visual" });
			checkVisual.innerHTML = `<svg viewBox="0 0 12 10" fill="none" xmlns="http://www.w3.org/2000/svg"><polyline points="1.5,5 4.5,8.5 10.5,1.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

			// Label + streak
			const labelWrap = row.createDiv({ cls: "habit-label-wrap" });
			const lbl = labelWrap.createEl("label", { cls: "habit-label", text: habit });
			lbl.setAttribute("for", `habit-cb-${key}`);

			if (streak > 0) {
				const streakEl = labelWrap.createEl("span", { cls: "habit-streak" });
				streakEl.innerHTML = `🔥 ${streak}`;
			}

			checkbox.addEventListener("change", async (e) => {
				const target = e.target as HTMLInputElement;
				row.toggleClass("habit-row--checked", target.checked);
				await this.app.fileManager.processFrontMatter(file as TFile, (fm) => {
					fm[key] = target.checked;
				});
				setTimeout(() => this.plugin.app.workspace.trigger("layout-change"), 100);
			});

			// Clicking the visual also toggles
			checkVisual.addEventListener("click", () => {
				checkbox.click();
			});
		});

		// ── Completion summary ────────────────────────────────────────────────
		const total = this.plugin.settings.habitsList.length;
		const done = this.plugin.settings.habitsList.filter(habit => {
			const key = `habit-${habit.toLowerCase().replace(/\s+/g, '-')}`;
			return frontmatter[key] === true;
		}).length;

		const summary = container.createDiv({ cls: "habits-summary" });
		const pct = total > 0 ? Math.round((done / total) * 100) : 0;
		summary.createEl("span", { cls: "habits-summary-text", text: `${done} / ${total} complete` });
		const bar = summary.createDiv({ cls: "habits-progress-bar" });
		const fill = bar.createDiv({ cls: "habits-progress-fill" });
		fill.style.width = `${pct}%`;
		if (pct === 100) fill.addClass("habits-progress-fill--complete");
	}
}