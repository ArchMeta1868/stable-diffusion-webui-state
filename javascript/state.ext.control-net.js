/* ------------------------------------------------------
   Setup
------------------------------------------------------ */

window.state = window.state || {};
window.state.extensions = window.state.extensions || {};
state = window.state;

/**
 * This context tracks a specific ControlNet tab (txt2img or img2img).
 * Inside each tab, there may be multiple ControlNet "units" (sub-tabs).
 */
function ControlNetTabContext(tabName, container) {
    this.tabName = tabName;
    this.container = container;
    this.store = new state.Store(`ext-control-net-${this.tabName}`);
    this.tabElements = [];
    this.cnTabs = [];

    // Identify sub-tabs for each ControlNet unit
    let tabs = this.container.querySelectorAll(':scope > div > div > .tabs > .tabitem');
    if (tabs.length) {
        tabs.forEach((tabContainer, i) => {
            this.cnTabs.push({
                container: tabContainer,
                store: new state.Store(`ext-control-net-${this.tabName}-${i}`)
            });
        });
    } else {
        // If no .tabitem found, treat the entire container as a single "unit"
        this.cnTabs.push({
            container: container,
            store: new state.Store(`ext-control-net-${this.tabName}-0`)
        });
    }
}

/* ------------------------------------------------------
   Main Extension
------------------------------------------------------ */

state.extensions['control-net'] = (function () {

    let contexts = [];

    /**
     * Toggles open/close of a ControlNet panel based on stored "toggled" state.
     */
    function handleToggle() {
        const id = 'toggled';

        contexts.forEach(context => {
            const elements = context.container.querySelectorAll(':scope > .label-wrap');
            elements.forEach(element => {
                if (context.store.get(id) === 'true') {
                    state.utils.clickToggleMenu(element);
                    load(); // reload after toggling
                }
                element.addEventListener('click', function () {
                    let classList = Array.from(this.classList);
                    context.store.set(id, classList.indexOf('open') > -1);
                    load();
                });
            });
        });
    }

    /**
     * Binds click events for the sub-tabs (ControlNet Unit 0, 1, 2, etc.).
     */
    function bindTabEvents() {
        contexts.forEach(context => {
            const tabs = context.container.querySelectorAll(':scope > div > div > .tabs > div > button');

            function onTabClick() {
                context.store.set('tab', this.textContent);
                bindTabEvents(); // re-bind after storing
            }

            tabs.forEach(tab => {
                tab.removeEventListener('click', onTabClick);
                tab.addEventListener('click', onTabClick);
            });

            context.tabElements = tabs;
        });
    }

    /**
     * Restores whichever sub-tab was active last time.
     */
    function handleTabs() {
        bindTabEvents();
        contexts.forEach(context => {
            let value = context.store.get('tab');
            if (value) {
                for (let i = 0; i < context.tabElements.length; i++) {
                    if (context.tabElements[i].textContent === value) {
                        state.utils.triggerEvent(context.tabElements[i], 'click');
                        break;
                    }
                }
            }
        });
    }

    /**
     * Runs a given action for each "ControlNet unit" container in every context.
     */
    function handleContext(action) {
        contexts.forEach(context => {
            context.cnTabs.forEach(({ container, store }) => {
                action(container, store);
            });
        });
    }

    /* ------------------------------------------------------
       UI Handling
    ------------------------------------------------------ */

    /**
     * Handle checkboxes. We look for multiple label structures:
     *  - checkbox.labels (native <label for="id">),
     *  - a parent <label>,
     *  - the old "nextElementSibling" approach for text.
     */
    function handleCheckboxes() {
        handleContext((container, store) => {
            let checkboxes = container.querySelectorAll('input[type="checkbox"]');
            checkboxes.forEach(checkbox => {

                let labelText =
                    checkbox.labels?.[0]?.textContent?.trim() ||            // <label for="checkboxId">…</label>
                    checkbox.closest('label')?.textContent?.trim() ||       // <label><input /></label>
                    checkbox.nextElementSibling?.textContent?.trim();       // old approach

                if (!labelText) return; // If we can’t find any label, skip

                let id = state.utils.txtToId(labelText);
                let value = store.get(id);
                if (value) {
                    state.utils.setValue(checkbox, value, 'change');
                }

                checkbox.addEventListener('change', function () {
                    store.set(id, this.checked);
                });
            });
        });
    }

    /**
     * Handle .gradio-dropdown <select> elements. Looks for a <label> inside them.
     */
    function handleSelects() {
        handleContext((container, store) => {
            container.querySelectorAll('.gradio-dropdown').forEach(select => {
                let labelEl = select.querySelector('label');
                let labelText = labelEl?.textContent?.trim();
                if (!labelText) return;

                let id = state.utils.txtToId(labelText);
                let value = store.get(id);

                // Use the existing utility to handle the select
                state.utils.handleSelect(select, id, store);

                // If this is the 'preprocessor' select and it has a value,
                // schedule a handleNumericInputs re-check for new sliders.
                if (id === 'preprocessor' && value && value.toLowerCase() !== 'none') {
                    state.utils.onNextUiUpdates(handleNumericInputs);
                }
            });
        });
    }

    /**
     * Combined handler for both sliders (`type="range"`) AND number inputs (`type="number"`).
     * We attempt to find the label text in multiple ways.
     */
    function handleNumericInputs() {
        handleContext((container, store) => {
            // Query both range- and number-type inputs
            let inputs = container.querySelectorAll('input[type="range"], input[type="number"]');

            inputs.forEach(input => {
                // Try these possible label lookups in sequence
                let labelText =
                    input.labels?.[0]?.textContent?.trim() ||                           // <label for="inputId">
                    input.closest('label')?.textContent?.trim() ||                      // <label><input… /></label>
                    input.previousElementSibling?.querySelector('label span')?.textContent?.trim(); // old fallback

                if (!labelText) {
                    // No label found. If you prefer, you could fallback to input.name or input.id:
                    // labelText = input.name || input.id;
                    // if still no label => skip
                    return;
                }

                let id = state.utils.txtToId(labelText);
                let value = store.get(id);

                if (value !== undefined && value !== null) {
                    state.utils.setValue(input, value, 'change');
                }

                // Save new value on change
                input.addEventListener('change', function () {
                    store.set(id, this.value);
                });
            });
        });
    }

    /**
     * Handle radio buttons by looking at the <fieldset> and <legend>.
     */
    function handleRadioButtons() {
        handleContext((container, store) => {
            let fieldsets = container.querySelectorAll('fieldset');
            fieldsets.forEach(fieldset => {
                let legend = fieldset.querySelector('legend');
                if (!legend) return;

                let labelText = legend.textContent?.trim();
                if (!labelText) return;

                let id = state.utils.txtToId(labelText);
                let radios = fieldset.querySelectorAll('input[type="radio"]');
                let value = store.get(id);

                if (value) {
                    radios.forEach(radio => {
                        state.utils.setValue(radio, value, 'change');
                    });
                }

                radios.forEach(radio => {
                    radio.addEventListener('change', function () {
                        store.set(id, this.value);
                    });
                });
            });
        });
    }

    /**
     * Handle textareas (prompts, etc.).
     * Similar multi-structure approach: .labels, parent label, or previous sibling.
     */
    function handleTextareas() {
        handleContext((container, store) => {
            let textareas = container.querySelectorAll('textarea');
            textareas.forEach(textarea => {
                let labelText =
                    textarea.labels?.[0]?.textContent?.trim() ||
                    textarea.closest('label')?.textContent?.trim() ||
                    textarea.previousElementSibling?.textContent?.trim();

                if (!labelText) return;

                let id = state.utils.txtToId(labelText);
                let value = store.get(id);
                if (value) {
                    state.utils.setValue(textarea, value, 'change');
                }

                textarea.addEventListener('change', function () {
                    store.set(id, this.value);
                });
            });
        });
    }

    /**
     * After a brief delay, run all handlers so the UI is ready to reflect stored values.
     */
    function load() {
        setTimeout(function () {
            handleTabs();
            handleCheckboxes();
            handleSelects();
            handleNumericInputs();  // Combined sliders + number fields
            handleRadioButtons();
            handleTextareas();
        }, 500);
    }

    /**
     * Called once to initialize everything (usually after the Gradio app is loaded).
     */
    function init() {
        let elements = gradioApp().querySelectorAll('#controlnet');
        if (!elements.length) {
            return;
        }

        // We expect #controlnet to appear for txt2img and img2img
        contexts[0] = new ControlNetTabContext('txt2img', elements[0]);
        contexts[1] = new ControlNetTabContext('img2img', elements[1]);

        handleToggle();
        load();
    }

    // Return only the init() publicly
    return { init };
}());
