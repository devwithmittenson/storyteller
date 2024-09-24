import { StorySheet } from './sheets/story-sheet.js';
import { FullscreenStorySheet } from './sheets/fullscreen-story-sheet.js';

class StoryTeller {

    // Define the different sheet types and labels for stories
    static types = {
        default: JournalSheet,  // Default journal entry
        story: StorySheet,      // Custom story sheet
        // fullscreen: FullscreenStorySheet,  // Fullscreen story sheet (commented out)
    }

    static labels = {
        story: "STORYTELLER.StoryEntry",
        default: "STORYTELLER.BaseJournalEntry",
        // fullscreen: "STORYTELLER.FullscreenStoryEntry",
    }

    // Return the registered document types (journal sheets)
    static getDocumentTypes() {
        return StoryTeller.types;
    }

    // Return the labels for the document types
    static getTypeLabels() {
        return StoryTeller.labels;
    }

    // Initialize the module
    init() {
        let types = StoryTeller.getDocumentTypes();
        let labels = StoryTeller.getTypeLabels();

        // Register the sheets and set up socket listeners
        this.registerObjects(types, labels);
        this._activateSocketListeners(game.socket);
    }

    // Register additional addon sheets dynamically
    registerAddonSheet(s) {
        let types = {};
        let labels = {};

        // Add the new sheet type and label
        types[s.key] = s.sheet;
        labels[s.key] = s.label;

        // Register the new objects and update the static storage
        this.registerObjects(types, labels);
        StoryTeller.types[s.key] = s.sheet;
        StoryTeller.labels[s.key] = s.label;
    }

    // Register the journal sheet types in Foundry's configuration
    registerObjects(types, labels) {
        for (let [key, sheet] of Object.entries(types)) {
            // Skip the default journal entry
            if (key === 'default') continue;

            // Register the sheet using the new Foundry VTT v12 method
            JournalEntry.registerSheet("journals", sheet, {
                types: ["base"],      // Register for base JournalEntry type
                makeDefault: false,   // Don't make it the default journal sheet
                label: game.i18n.localize(labels[key])  // Localize the label
            });
        }

        // Merge new types into the system's document types for JournalEntry
        game.system.documentTypes.JournalEntry = game.system.documentTypes.JournalEntry.concat(Object.keys(types)).sort();

        // Merge labels into CONFIG for JournalEntry types
        CONFIG.JournalEntry.typeLabels = foundry.utils.mergeObject(CONFIG.JournalEntry.typeLabels || {}, labels);
    }

    // Update the image URL for the journal entry
    changeLinkedImageSrc(input) {
        let form = input.closest("form");
        let newSrc = input.value;
        let image = form.querySelector("div.image-container");
        let tooltip = form.querySelector("div.image-container .storyteller-tooltip");

        // Set the new background image
        image.style.backgroundImage = `url('${newSrc}')`;

        // Hide the tooltip if present
        if (tooltip) {
            tooltip.style.display = 'none';
        }
    }

    // Set up socket listeners for real-time updates
    _activateSocketListeners(socket) {
        socket.on("module.storyteller", this._setPageToOpen.bind(this));
    }

    // Handle socket event to set the page to open for all users
    async _setPageToOpen(data) {
        if (data.action !== "setPageToOpen" || data.id === "") return;

        // Get the current pages settings and update it
        let pages = game.settings.get('storyteller', 'pages');
        pages[data.id] = data.page;
        await game.settings.set('storyteller', 'pages', pages);
    }

    // Show a story to all players and synchronize the page
    showStoryByIDToAll(id = "", page = 0) {
        if (page !== 0) {
            // Emit socket event to all clients
            game.socket.emit("module.storyteller", {
                action: "setPageToOpen",
                id: id,
                page: page
            });

            // Update local settings
            let pages = game.settings.get('storyteller', 'pages');
            pages[id] = page;
            game.settings.set('storyteller', 'pages', pages);
        }

        // Retrieve the journal entry and display it
        let story = game.journal.get(id);
        story.show("text");
    }

    // Show a story only to the current player
    showStoryToPlayerOnly(id = "", page = 0) {
        if (page !== 0) {
            // Update the current page in settings
            let pages = game.settings.get('storyteller', 'pages');
            pages[id] = page;
            game.settings.set('storyteller', 'pages', pages);
        }

        // Retrieve the journal entry and render it only for the player
        let story = game.journal.get(id);
        story.sheet.render(true);
    }

    // Used to store a temporary type selection
    setVeryDirtyHack(type = "") {
        this.activeType = type;
    }

    // Retrieve the stored temporary type selection
    getVeryDirtyHack() {
        return this.activeType;
    }
}

// Initialization hook to register settings and initialize StoryTeller
Hooks.on("init", () => {
    registerSettings();
    game.StoryTeller = new StoryTeller();
    game.StoryTeller.init();

    console.log("Storyteller | Init");
});

// Hook to log when the module is fully ready
Hooks.on("ready", () => {
    console.log("Storyteller | Ready");
});

// Hook to handle custom logic when a dialog is closed
Hooks.on("closeDialog", (dialog, html, data) => {
    game.StoryTeller.setVeryDirtyHack("");
    let selectForm = document.getElementById("app-" + dialog.appId);
    if (selectForm) {
        let select = selectForm.querySelector("select");
        if (select) {
            game.StoryTeller.setVeryDirtyHack(select.value);
        }
    }
});

// Pre-create hook to set the journal entry type before creation
Hooks.on("preCreateJournalEntry", preCreateJournalEntry);
function preCreateJournalEntry(entry, data, options, userId) {
    let types = StoryTeller.getDocumentTypes();
    let currentType = game.StoryTeller.getVeryDirtyHack();

    // Set the journal type if a custom one is selected
    if (Object.keys(types).includes(currentType) && currentType !== "default") {
        options.type = currentType;
    }
}

// Post-create hook to set the custom sheet after creation
Hooks.on("createJournalEntry", createJournalEntry);
async function createJournalEntry(doc, options, userId) {
    let types = StoryTeller.getDocumentTypes();
    if (game.user.id !== userId || !Object.keys(types).includes(options.type)) return;

    // Deregister the current sheet and apply the custom sheet
    const sheet = doc.sheet;
    doc._sheet = null;
    delete doc.apps[sheet.appId];

    let cls = types[options.type].name;
    await doc.setFlag("core", "sheetClass", "journals." + cls);
    await sheet.close();
    await postCreateJournalEntry(doc.data._id);
}

// Function to render the journal sheet after creation
async function postCreateJournalEntry(id = "") {
    let story = game.journal.get(id);
    story.sheet.render(true);
}

// Register settings for the module
function registerSettings() {
    game.settings.register('storyteller', 'bookOpenSound', {
        name: game.i18n.localize('STORYTELLER.BookOpenSound'),
        hint: game.i18n.localize('STORYTELLER.BookOpenSoundHint'),
        scope: "client",
        type: Boolean,
        default: true,
        config: true,
    });

    game.settings.register('storyteller', 'size', {
        name: game.i18n.localize('STORYTELLER.Settings.Size'),
        hint: game.i18n.localize('STORYTELLER.Settings.SizeHint'),
        scope: "world",
        type: Number,
        choices: {
            70: "70%",
            80: "80%",
            90: "90%",
            100: "100%",
        },
        default: 80,
        config: true,
    });

    game.settings.register('storyteller', 'enableScroll', {
        name: game.i18n.localize('STORYTELLER.Settings.EnableScroll'),
        hint: game.i18n.localize('STORYTELLER.Settings.EnableScrollHint'),
        scope: "client",
        type: Boolean,
        default: false,
        config: true,
    });

    game.settings.register('storyteller', 'pages', {
        scope: "client",
        type: Object,
        default: {},
        config: false,
    });

    // Deprecated settings kept for migration
    game.settings.register('storyteller', 'storiesEntries', {
        scope: 'world',
        config: false,
        type: Object,
        default: {}
    });
    game.settings.register('storyteller', 'restored', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
}
