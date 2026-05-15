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

// Define the shape of our plugin data
interface HabitsPluginSettings {
	habitsList: string[];
	startDate: string;
}

const DEFAULT_SETTINGS: HabitsPluginSettings = {
	habitsList: ["Workout", "Meditation", "Reading", "Coding"],
	startDate: "2026-01-01" // Default fallback start date
}

export default class HabitsPlugin extends Plugin {
	settings: HabitsPluginSettings;

	async onload() {
		await this.loadSettings();

		// 1. Register Sidebar View
		this.registerView(
			VIEW_TYPE_HABITS,
			(leaf) => new HabitsSidebarView(leaf, this)
		);

		// FIX: Using a reliable native Obsidian Lucide icon string 'calendar-heart'
		this.addRibbonIcon('calendar-heart', 'Open Habits Tracker', () => {
			this.activateView();
		});

		// 2. Register Heatmap Codeblock
		this.registerMarkdownCodeBlockProcessor("habit-heatmap", (source, el, ctx) => {
			this.renderHeatmap(el);
		});

		// Add Settings Tab
		this.addSettingTab(new HabitsSettingTab(this.app, this));

		// Global layout listener to sync data updates
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
		// Refresh views dynamically when settings change
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

	getTodayNotePath(): string {
		let format = "YYYY-MM-DD";
		let folder = "";

		const dailyNotesSetting = (this.app as any).internalPlugins?.plugins?.["daily-notes"]?.instance?.options;
		if (dailyNotesSetting) {
			format = dailyNotesSetting.format || format;
			folder = dailyNotesSetting.folder || folder;
		}

		const fileName = (window as any).moment().format(format) + ".md";
		return normalizePath(folder ? `${folder}/${fileName}` : fileName);
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

		// Generate the matrix row by row for each habit
		this.settings.habitsList.forEach(habit => {
			const row = container.createDiv({ cls: "matrix-row" });
			row.createDiv({ cls: "matrix-label", text: habit }); // Habit Name Column
			
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
 * Settings Tab Component
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

		// 1. Start Date Setting
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

		// 2. Habits List Setting
		new Setting(containerEl)
			.setName('Tracked Habits')
			.setDesc('Comma-separated list of habits you want to track (e.g. Workout, Meditation, Reading)')
			.addTextArea(text => text
				.setPlaceholder('Workout, Meditation, Reading')
				.setValue(this.plugin.settings.habitsList.join(', '))
				.onChange(async (value) => {
					// Clean up spaces and split items into an array
					this.plugin.settings.habitsList = value
						.split(',')
						.map(h => h.trim())
						.filter(h => h.length > 0);
					await this.plugin.saveSettings();
				}));
	}
}

/**
 * Sidebar View Component
 */
class HabitsSidebarView extends ItemView {
	plugin: HabitsPlugin;

	constructor(leaf: WorkspaceLeaf, plugin: HabitsPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_HABITS;
	}

	getDisplayText(): string {
		return "Habits Panel";
	}

	async onOpen() {
		this.updateView();
	}

	async updateView() {
		const container = this.contentEl;
		container.empty();
		container.addClass("lightworx-habits-sidebar-container");

		container.createEl("h3", { text: "Today's Habits" });

		const todayPath = this.plugin.getTodayNotePath();
		const file = this.app.vault.getAbstractFileByPath(todayPath);

		let frontmatter: Record<string, any> = {};
		if (file && file instanceof TFile) {
			const cache = this.app.metadataCache.getFileCache(file);
			frontmatter = cache?.frontmatter || {};
		} else {
			container.createDiv({ cls: "habit-notice", text: "Today's daily note hasn't been created yet." });
			const createBtn = container.createEl("button", { text: "Create Daily Note" });
			createBtn.addEventListener("click", async () => {
				await this.app.vault.create(todayPath, "---\n---\n");
				this.updateView();
			});
			return;
		}

		if (this.plugin.settings.habitsList.length === 0) {
			container.createDiv({ cls: "habit-notice", text: "Go to settings to add habits to track!" });
			return;
		}

		this.plugin.settings.habitsList.forEach(habit => {
			// Convert "Read Book" into frontmatter standard lookup key format: "habit-read-book"
			const key = `habit-${habit.toLowerCase().replace(/\s+/g, '-')}`;
			const isChecked = frontmatter[key] === true;

			const row = container.createDiv({ cls: "habit-row" });
			const checkbox = row.createEl("input", { type: "checkbox" });
			checkbox.checked = isChecked;
			
			row.createEl("label", { text: habit });

			checkbox.addEventListener("change", async (e) => {
				const target = e.target as HTMLInputElement;
				await this.app.fileManager.processFrontMatter(file as TFile, (fm) => {
					fm[key] = target.checked;
				});
				setTimeout(() => this.plugin.app.workspace.trigger("layout-change"), 100);
			});
		});
	}
}