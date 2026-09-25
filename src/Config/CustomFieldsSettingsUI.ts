import {
    type App,
    ButtonComponent,
    Modal,
    Setting,
    type SettingDefinition,
    type SettingDefinitionItem,
    sanitizeHTMLToDom,
} from 'obsidian';
import type { CustomFieldDefinition, CustomFieldType } from '../CustomFields/CustomFieldDefinition';
import { validateCustomFieldDefinition } from '../CustomFields/CustomFieldValidation';
import { i18n } from '../i18n/i18n';
import type TasksPlugin from '../main';
import type { TasksEvents } from '../Obsidian/TasksEvents';
import { getSettings, updateSettings } from './Settings';

/**
 * The "Custom fields" settings (fork roadmap item 5), for both of `SettingsTab`'s settings UIs:
 * {@link getDefinitions} for the declarative one (Obsidian 1.13.0+), {@link renderSettings} for the
 * imperative fallback. Both share the same edit modal and save logic, so they can't drift apart.
 */
export class CustomFieldsSettingsUI {
    constructor(private readonly plugin: TasksPlugin, private readonly events: TasksEvents) {}

    public getDefinitions(refresh: () => void): SettingDefinitionItem {
        const definitions = getSettings().customFields;
        return {
            type: 'list',
            heading: i18n.t('settings.customFields.heading'),
            emptyState: i18n.t('settings.customFields.emptyState'),
            extraButtons: [
                (btn) =>
                    btn
                        .setIcon('info')
                        .setTooltip(i18n.t('common.moreInfo'))
                        .onClick(() => this.showInfoModal()),
            ],
            addItem: {
                name: i18n.t('settings.customFields.buttons.addField'),
                action: () => this.openModal(null, refresh),
            },
            onReorder: (oldIndex, newIndex) => {
                const updated = [...getSettings().customFields];
                const [moved] = updated.splice(oldIndex, 1);
                updated.splice(newIndex, 0, moved);
                // The list has already moved the row, so no refresh is needed.
                this.save(updated, null);
            },
            onDelete: (index) => {
                const updated = getSettings().customFields.filter((_, i) => i !== index);
                this.save(updated, refresh);
            },
            items: definitions.map((definition, index): SettingDefinition => {
                return {
                    name: definition.label,
                    desc: CustomFieldsSettingsUI.rowDescription(definition),
                    aliases: [i18n.t('settings.customFields.heading'), definition.key],
                    render: (setting) => {
                        CustomFieldsSettingsUI.decorateRow(setting, definition);
                        setting.addExtraButton((btn) => {
                            btn.setIcon('pencil')
                                .setTooltip(i18n.t('common.edit'))
                                .onClick(() => this.openModal(index, refresh));
                        });
                    },
                };
            }),
        };
    }

    public renderSettings(containerEl: HTMLElement, refresh: () => void) {
        new Setting(containerEl).setName(i18n.t('settings.customFields.heading')).setHeading();
        new Setting(containerEl).setDesc(sanitizeHTMLToDom(CustomFieldsSettingsUI.descriptionHtml()));

        const definitions = getSettings().customFields;
        definitions.forEach((definition, index) => {
            const setting = new Setting(containerEl)
                .setName(definition.label)
                .setDesc(CustomFieldsSettingsUI.rowDescription(definition));
            CustomFieldsSettingsUI.decorateRow(setting, definition);
            const move = (offset: number) => {
                const updated = [...getSettings().customFields];
                const [moved] = updated.splice(index, 1);
                updated.splice(index + offset, 0, moved);
                this.save(updated, refresh);
            };
            if (index > 0) {
                setting.addExtraButton((btn) => btn.setIcon('arrow-up').onClick(() => move(-1)));
            }
            if (index < definitions.length - 1) {
                setting.addExtraButton((btn) => btn.setIcon('arrow-down').onClick(() => move(1)));
            }
            setting.addExtraButton((btn) =>
                btn
                    .setIcon('pencil')
                    .setTooltip(i18n.t('common.edit'))
                    .onClick(() => this.openModal(index, refresh)),
            );
            setting.addExtraButton((btn) =>
                btn.setIcon('cross').onClick(() => {
                    this.save(
                        getSettings().customFields.filter((_, i) => i !== index),
                        refresh,
                    );
                }),
            );
        });

        new Setting(containerEl).addButton((button) =>
            button
                .setButtonText(i18n.t('settings.customFields.buttons.addField'))
                .setCta()
                .onClick(() => this.openModal(null, refresh)),
        );
    }

    private static rowDescription(definition: CustomFieldDefinition): string {
        const property = definition.defaultFromProperty.trim();
        return property === ''
            ? i18n.t('settings.customFields.noDefault')
            : i18n.t('settings.customFields.defaultFrom', { property });
    }

    /**
     * Shows the field's symbol and key before its name, like the status symbol chip in the statuses list,
     * and its type as a flair.
     */
    private static decorateRow(setting: Setting, definition: CustomFieldDefinition) {
        setting.nameEl.createEl('code', {
            cls: 'tasks-status-symbol',
            text: `${definition.symbol} ${definition.key}`,
            prepend: true,
        });
        setting.controlEl.createSpan({ cls: 'flair', text: CustomFieldsSettingsUI.typeName(definition.type) });
    }

    public static typeName(type: CustomFieldType) {
        return type === 'noteLink'
            ? i18n.t('settings.customFields.types.noteLink')
            : i18n.t('settings.customFields.types.text');
    }

    private static descriptionHtml() {
        return (
            `<p>${i18n.t('settings.customFields.description.line1')}</p>` +
            `<p>${i18n.t('settings.customFields.description.line2')}</p>` +
            `<p>${i18n.t('settings.customFields.description.line3')}</p>`
        );
    }

    private showInfoModal() {
        const modal = new Modal(this.plugin.app);
        modal.setTitle(i18n.t('settings.customFields.heading'));
        modal.contentEl.append(sanitizeHTMLToDom(CustomFieldsSettingsUI.descriptionHtml()));
        const buttonContainerEl = modal.contentEl.createDiv({ cls: 'modal-button-container' });
        new ButtonComponent(buttonContainerEl).setButtonText(i18n.t('common.okay')).onClick(() => modal.close());
        modal.open();
    }

    /**
     * @param index - the field to edit, or null to add a new one
     */
    private openModal(index: number | null, refresh: () => void) {
        const definitions = getSettings().customFields;
        const existing = index === null ? null : definitions[index];
        const others = definitions.filter((_, i) => i !== index);
        new CustomFieldModal(this.plugin.app, existing, others, (definition) => {
            const updated = [...getSettings().customFields];
            if (index === null) {
                updated.push(definition);
            } else {
                updated[index] = definition;
            }
            this.save(updated, refresh);
        }).open();
    }

    /**
     * Save a new list of definitions, then re-read the vault: whether a task line holds a custom field depends
     * on the definitions.
     */
    private save(definitions: CustomFieldDefinition[], refresh: (() => void) | null) {
        // Always a new array: see Settings.customFields.
        updateSettings({ customFields: [...definitions] });
        void this.plugin.saveSettings();
        this.events.triggerReloadVault();
        refresh?.();
    }
}

/**
 * Adds or edits one custom field definition.
 */
class CustomFieldModal extends Modal {
    private readonly draft: CustomFieldDefinition;
    private keyEdited: boolean;

    constructor(
        app: App,
        existing: CustomFieldDefinition | null,
        private readonly others: readonly CustomFieldDefinition[],
        private readonly onSave: (definition: CustomFieldDefinition) => void,
    ) {
        super(app);
        this.draft = existing
            ? { ...existing }
            : { key: '', label: '', symbol: '', type: 'text', defaultFromProperty: '' };
        // For a new field, the key follows the name until the user types a key of their own.
        this.keyEdited = existing !== null;
        this.setTitle(
            existing === null
                ? i18n.t('modals.customFieldModal.title.add')
                : i18n.t('modals.customFieldModal.title.edit'),
        );
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();

        let keyInput: HTMLInputElement | null = null;
        new Setting(contentEl)
            .setName(i18n.t('modals.customFieldModal.label.name'))
            .setDesc(i18n.t('modals.customFieldModal.label.description'))
            .addText((text) => {
                text.setPlaceholder('Project')
                    .setValue(this.draft.label)
                    .onChange((value) => {
                        this.draft.label = value;
                        if (!this.keyEdited && keyInput) {
                            this.draft.key = CustomFieldModal.keyFromLabel(value);
                            keyInput.value = this.draft.key;
                        }
                    });
            });

        new Setting(contentEl)
            .setName(i18n.t('modals.customFieldModal.key.name'))
            .setDesc(i18n.t('modals.customFieldModal.key.description'))
            .addText((text) => {
                keyInput = text.inputEl;
                text.setPlaceholder('project')
                    .setValue(this.draft.key)
                    .onChange((value) => {
                        this.draft.key = value.trim();
                        this.keyEdited = true;
                    });
            });

        new Setting(contentEl)
            .setName(i18n.t('modals.customFieldModal.symbol.name'))
            .setDesc(i18n.t('modals.customFieldModal.symbol.description'))
            .addText((text) => {
                text.setPlaceholder('📁')
                    .setValue(this.draft.symbol)
                    .onChange((value) => {
                        this.draft.symbol = value.trim();
                    });
            });

        new Setting(contentEl)
            .setName(i18n.t('modals.customFieldModal.type.name'))
            .setDesc(i18n.t('modals.customFieldModal.type.description'))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption('text', CustomFieldsSettingsUI.typeName('text'))
                    .addOption('noteLink', CustomFieldsSettingsUI.typeName('noteLink'))
                    .setValue(this.draft.type)
                    .onChange((value) => {
                        this.draft.type = value as CustomFieldType;
                    });
            });

        new Setting(contentEl)
            .setName(i18n.t('modals.customFieldModal.defaultFromProperty.name'))
            .setDesc(i18n.t('modals.customFieldModal.defaultFromProperty.description'))
            .addText((text) => {
                text.setPlaceholder('project')
                    .setValue(this.draft.defaultFromProperty)
                    .onChange((value) => {
                        this.draft.defaultFromProperty = value.trim();
                    });
            });

        const errorEl = contentEl.createDiv({ cls: 'tasks-custom-field-modal-error mod-warning' });

        const buttonContainerEl = contentEl.createDiv({ cls: 'modal-button-container' });
        new ButtonComponent(buttonContainerEl).setButtonText(i18n.t('common.cancel')).onClick(() => this.close());
        new ButtonComponent(buttonContainerEl)
            .setButtonText(i18n.t('common.save'))
            .setCta()
            .onClick(() => {
                const definition: CustomFieldDefinition = {
                    ...this.draft,
                    key: this.draft.key.trim(),
                    label: this.draft.label.trim(),
                    symbol: this.draft.symbol.trim(),
                    defaultFromProperty: this.draft.defaultFromProperty.trim(),
                };
                const error = validateCustomFieldDefinition(definition, this.others);
                if (error !== null) {
                    errorEl.setText(error);
                    return;
                }
                this.onSave(definition);
                this.close();
            });
    }

    onClose() {
        this.contentEl.empty();
    }

    /**
     * 'Due Soon' becomes 'due-soon'. Characters a key can't hold are dropped.
     */
    private static keyFromLabel(label: string) {
        return label
            .trim()
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9_-]/g, '')
            .replace(/^[^a-z]+/, '');
    }
}
