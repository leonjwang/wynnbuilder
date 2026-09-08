/**
 * WynnBuilder Browser CLI (Terminal in Browser) Engine
 * Integrates directly with WynnBuilder computation graph, loaders, and state.
 */

(function () {
    "use strict";

    // CLI State
    const history = [];
    let historyIndex = -1;
    let isInitialized = false;

    // DOM references
    let outputElem;
    let inputElem;
    let promptPrefixElem;
    let statusPillElem;

    const COMMANDS = [
        "help", "build", "atree", "equip", "unequip", "powder", "level",
        "sp", "stats", "damage", "item", "search", "boost",
        "optimize", "link", "import", "reset", "clear", "history", "gui",
        "tree", "ability"
    ];

    const SLOTS = [
        "helmet", "chestplate", "leggings", "boots",
        "ring1", "ring2", "bracelet", "necklace", "weapon"
    ];

    const VALID_EQUIP_SLOTS = [
        "helmet", "chestplate", "leggings", "boots",
        "ring1", "ring2", "ring", "bracelet", "necklace", "weapon"
    ];

    const SLOT_ALIASES = {
        "h": "helmet", "helm": "helmet", "helmet": "helmet",
        "c": "chestplate", "chest": "chestplate", "chestplate": "chestplate",
        "l": "leggings", "legs": "leggings", "leggings": "leggings",
        "b": "boots", "boot": "boots", "boots": "boots",
        "r": "ring", "ring": "ring", "rings": "ring",
        "r1": "ring1", "ring1": "ring1",
        "r2": "ring2", "ring2": "ring2",
        "br": "bracelet", "brace": "bracelet", "bracelet": "bracelet",
        "n": "necklace", "neck": "necklace", "necklace": "necklace",
        "w": "weapon", "wep": "weapon", "weapon": "weapon",
        "wand": "weapon", "bow": "weapon", "dagger": "weapon", "spear": "weapon", "relik": "weapon"
    };

    /**
     * Initialize the CLI once DOM and scripts are ready.
     */
    async function initCLI() {
        outputElem = document.getElementById("term-output");
        inputElem = document.getElementById("term-input");
        promptPrefixElem = document.getElementById("term-prompt-prefix");
        statusPillElem = document.getElementById("term-status");

        if (!outputElem || !inputElem) {
            console.error("Terminal elements missing from DOM.");
            return;
        }

        // Setup input event listeners
        inputElem.addEventListener("keydown", handleKeyDown);
        document.getElementById("terminal-view").addEventListener("click", () => {
            inputElem.focus();
        });

        // Setup quick bar buttons
        document.querySelectorAll("[data-term-cmd]").forEach(btn => {
            btn.addEventListener("click", (e) => {
                const cmd = e.currentTarget.getAttribute("data-term-cmd");
                executeCommand(cmd);
            });
        });

        printBanner();
        printLine("Loading WynnBuilder databases and computation graph...", "term-line-system");

        // Wait for loader and graph to initialize
        await waitForBuilderInit();

        isInitialized = true;
        updateStatus(true);
        updatePrompt();

        printLine("WynnBuilder database initialized successfully!", "term-line-success");
        printLine("Type <span class='term-line-info'>help</span> to see available commands, or try <span class='term-line-info'>build</span> to view your build.", "term-line-system");

        // If URL hash was present, announce loaded build
        if (window.location.hash && window.location.hash.length > 2) {
            printLine("Build loaded from URL hash!", "term-line-info");
            executeCommand("build");
        }
    }

    /**
     * Poll until WynnBuilder globals and computation graph are ready.
     */
    async function waitForBuilderInit() {
        while (typeof itemMap === "undefined" || typeof stat_agg_node === "undefined" || typeof graph_live_update === "undefined" || !graph_live_update) {
            await new Promise(r => setTimeout(r, 60));
        }
    }

    function updateStatus(ready) {
        if (!statusPillElem) return;
        if (ready) {
            statusPillElem.className = "term-status-pill status-ready";
            statusPillElem.innerHTML = "● Ready";
        } else {
            statusPillElem.className = "term-status-pill status-loading";
            statusPillElem.innerHTML = "● Loading...";
        }
    }

    function updatePrompt() {
        if (!promptPrefixElem) return;
        let className = "No Class";
        let lvl = 106;
        if (typeof player_build !== "undefined" && player_build && player_build.weapon) {
            const wepType = player_build.weapon.statMap.get("type");
            if (wepType && typeof wep_to_class !== "undefined" && wep_to_class.has(wepType)) {
                className = wep_to_class.get(wepType);
                className = className.charAt(0).toUpperCase() + className.slice(1);
            }
            lvl = player_build.level || 106;
        } else {
            const lvlElem = document.getElementById("level-choice");
            if (lvlElem && lvlElem.value) lvl = lvlElem.value;
        }
        promptPrefixElem.textContent = `[${className} Lvl ${lvl}] wb> `;
    }

    function printBanner() {
        const banner = `Wynncraft Character Builder Terminal CLI`;
        const div = document.createElement("div");
        div.className = "term-banner";
        div.textContent = banner;
        outputElem.appendChild(div);
    }

    function printLine(htmlText, cssClass = "") {
        const p = document.createElement("p");
        p.className = `term-line ${cssClass}`;
        p.innerHTML = htmlText;
        outputElem.appendChild(p);
        outputElem.scrollTop = outputElem.scrollHeight;
    }

    function handleKeyDown(e) {
        if (e.key === "Enter") {
            e.preventDefault();
            const cmd = inputElem.value.trim();
            if (cmd) {
                history.push(cmd);
                historyIndex = history.length;
            }
            inputElem.value = "";
            executeCommand(cmd);
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (historyIndex > 0) {
                historyIndex--;
                inputElem.value = history[historyIndex];
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (historyIndex < history.length - 1) {
                historyIndex++;
                inputElem.value = history[historyIndex];
            } else {
                historyIndex = history.length;
                inputElem.value = "";
            }
        } else if (e.key === "Tab") {
            e.preventDefault();
            handleTabComplete();
        } else if (e.ctrlKey && e.key === "l") {
            e.preventDefault();
            cmdClear();
        } else if (e.ctrlKey && e.key === "c") {
            e.preventDefault();
            inputElem.value = "";
            printLine("^C", "term-line-system");
        }
    }

    /**
     * Autocompletion handler for commands, slots, and items
     */
    function handleTabComplete() {
        const text = inputElem.value;
        const tokens = text.split(/\s+/);
        
        // Completing command name
        if (tokens.length === 1) {
            const prefix = tokens[0].toLowerCase();
            const matches = COMMANDS.filter(c => c.startsWith(prefix));
            if (matches.length === 1) {
                inputElem.value = matches[0] + " ";
            } else if (matches.length > 1) {
                printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
            }
            return;
        }

        const cmd = tokens[0].toLowerCase();

        // Completing slots for unequip / powder
        if ((cmd === "unequip" || cmd === "uneq" || cmd === "powder") && tokens.length === 2) {
            const prefix = tokens[1].toLowerCase();
            const matches = SLOTS.filter(s => s.startsWith(prefix));
            if (matches.length === 1) {
                inputElem.value = `${tokens[0]} ${matches[0]} `;
            } else if (matches.length > 1) {
                printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
            }
            return;
        }

        // Completing slots or item names for equip
        if ((cmd === "equip" || cmd === "eq") && tokens.length >= 2) {
            let slot = null;
            let itemPrefix = "";

            if (tokens.length === 2) {
                const prefix = tokens[1].toLowerCase();
                const slotMatches = SLOTS.filter(s => s.startsWith(prefix));
                if (slotMatches.length === 1) {
                    inputElem.value = `${tokens[0]} ${slotMatches[0]} `;
                    return;
                } else if (slotMatches.length > 1) {
                    printLine(slotMatches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                    return;
                }
                // No slot matched, treat token 1 as item prefix
                itemPrefix = prefix;
            } else {
                const slotArg = tokens[1].toLowerCase();
                const potentialSlot = SLOT_ALIASES[slotArg] || (VALID_EQUIP_SLOTS.includes(slotArg) ? slotArg : null);
                if (potentialSlot) {
                    slot = potentialSlot;
                    itemPrefix = tokens.slice(2).join(" ").toLowerCase();
                } else {
                    itemPrefix = tokens.slice(1).join(" ").toLowerCase();
                }
            }

            let candidateList = [];
            if (slot === "weapon") {
                const weaponKeys = ["bow", "spear", "wand", "dagger", "relik"];
                for (const wk of weaponKeys) {
                    if (typeof itemLists !== "undefined" && itemLists.has(wk)) {
                        candidateList.push(...itemLists.get(wk));
                    }
                }
            } else if (slot && typeof itemLists !== "undefined" && itemLists.has(slot.replace(/[0-9]/g, ''))) {
                candidateList = itemLists.get(slot.replace(/[0-9]/g, ''));
            } else if (typeof items !== "undefined") {
                candidateList = items.map(i => i.displayName);
            }

            const matches = candidateList.filter(name => name && name.toLowerCase().startsWith(itemPrefix) && !name.startsWith("No "));
            if (matches.length === 1) {
                if (slot) {
                    inputElem.value = `${tokens[0]} ${tokens[1]} ${matches[0]}`;
                } else {
                    inputElem.value = `${tokens[0]} ${matches[0]}`;
                }
            } else if (matches.length > 1 && matches.length <= 15) {
                printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
            } else if (matches.length > 15) {
                printLine(`Matches (${matches.length}): ` + matches.slice(0, 10).map(m => `<span class='term-completion-item'>${m}</span>`).join(" ") + " ...", "term-completions");
            }
            return;
        }

        // Completing atree subcommands and ability names
        if (cmd === "atree" || cmd === "tree" || cmd === "ability") {
            const atreeSubcmds = ["toggle", "takable", "list", "info", "take", "remove", "reset", "help"];
            if (tokens.length === 2) {
                const prefix = tokens[1].toLowerCase();
                const matches = atreeSubcmds.filter(s => s.startsWith(prefix));
                if (matches.length === 1) {
                    inputElem.value = `${tokens[0]} ${matches[0]} `;
                } else if (matches.length > 1) {
                    printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                }
                return;
            }
            if (tokens.length >= 3) {
                const sub = tokens[1].toLowerCase();
                if (sub === "toggle" || sub === "take" || sub === "remove" || sub === "info" || sub === "t" || sub === "rm") {
                    if (typeof atree_node !== "undefined" && atree_node && atree_node.value) {
                        const namePrefix = tokens.slice(2).join(" ").toLowerCase();
                        const candidateNames = atree_node.value.map(n => n.ability.display_name || n.ability.name);
                        const matches = candidateNames.filter(n => n.toLowerCase().startsWith(namePrefix));
                        if (matches.length === 1) {
                            inputElem.value = `${tokens[0]} ${tokens[1]} ${matches[0]}`;
                        } else if (matches.length > 1 && matches.length <= 15) {
                            printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                        } else if (matches.length > 15) {
                            printLine(`Matches (${matches.length}): ` + matches.slice(0, 10).map(m => `<span class='term-completion-item'>${m}</span>`).join(" ") + " ...", "term-completions");
                        }
                    }
                }
                return;
            }
        }

        // Completing search flags and values
        if ((cmd === "search" || cmd === "find") && tokens.length >= 2) {
            const current = tokens[tokens.length - 1];
            const prev = tokens[tokens.length - 2].toLowerCase();

            if (prev === "-t" || prev === "--type") {
                const types = ["helmet", "chestplate", "leggings", "boots", "ring", "bracelet", "necklace", "wand", "bow", "dagger", "spear", "relik", "armor", "weapon", "accessory"];
                const matches = types.filter(t => t.startsWith(current.toLowerCase()));
                if (matches.length === 1) {
                    tokens[tokens.length - 1] = matches[0];
                    inputElem.value = tokens.join(" ") + " ";
                } else if (matches.length > 1) {
                    printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                }
                return;
            }

            if (prev === "-r" || prev === "--rarity") {
                const rarities = ["mythic", "fabled", "legendary", "rare", "set", "unique", "normal"];
                const matches = rarities.filter(r => r.startsWith(current.toLowerCase()));
                if (matches.length === 1) {
                    tokens[tokens.length - 1] = matches[0];
                    inputElem.value = tokens.join(" ") + " ";
                } else if (matches.length > 1) {
                    printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                }
                return;
            }

            if (prev === "-sort" || prev === "--sort") {
                const sortKeys = ["lvl", "wDam", "eDam", "tDam", "fDam", "aDam", "nDam", "mr", "ms", "spd", "sdPct", "mdPct", "hp", "slots", "strReq", "dexReq", "intReq", "defReq", "agiReq"];
                const matches = sortKeys.filter(k => k.toLowerCase().startsWith(current.toLowerCase()));
                if (matches.length === 1) {
                    tokens[tokens.length - 1] = matches[0];
                    inputElem.value = tokens.join(" ") + " ";
                } else if (matches.length > 1) {
                    printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                }
                return;
            }

            if (current.startsWith("-")) {
                const flags = ["-t", "-r", "-lvl", "-sort", "-n", "-f"];
                const matches = flags.filter(f => f.startsWith(current.toLowerCase()));
                if (matches.length === 1) {
                    tokens[tokens.length - 1] = matches[0];
                    inputElem.value = tokens.join(" ") + " ";
                } else if (matches.length > 1) {
                    printLine(matches.map(m => `<span class='term-completion-item'>${m}</span>`).join(" "), "term-completions");
                }
                return;
            }
        }
    }

    /**
     * Dispatcher for commands
     */
    async function executeCommand(cmdStr) {
        if (!cmdStr) return;

        // Print input prompt line in output log
        const promptText = promptPrefixElem ? promptPrefixElem.textContent : "wb> ";
        printLine(`<span class='term-prompt-prefix'>${escapeHtml(promptText)}</span><span class='term-line-cmd'>${escapeHtml(cmdStr)}</span>`);

        if (!isInitialized) {
            printLine("Database is still loading, please wait a moment...", "term-line-warn");
            return;
        }

        const parts = [];
        const regex = /[^\s"]+|"([^"]*)"/g;
        let match;
        while ((match = regex.exec(cmdStr.trim())) !== null) {
            parts.push(match[1] !== undefined ? match[1] : match[0]);
        }
        if (parts.length === 0) return;

        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        try {
            switch (command) {
                case "help":
                    cmdHelp(args);
                    break;
                case "build":
                case "show":
                case "b":
                    cmdBuild();
                    break;
                case "atree":
                case "tree":
                case "ability":
                case "abilities":
                    cmdAtree(args);
                    break;
                case "equip":
                case "eq":
                case "set":
                    cmdEquip(args);
                    break;
                case "unequip":
                case "uneq":
                case "remove":
                case "rm":
                    cmdUnequip(args);
                    break;
                case "powder":
                case "pow":
                    cmdPowder(args);
                    break;
                case "level":
                case "lvl":
                    cmdLevel(args);
                    break;
                case "sp":
                case "skillpoints":
                    cmdSkillPoints(args);
                    break;
                case "stats":
                case "stat":
                case "st":
                    cmdStats(args);
                    break;
                case "damage":
                case "dps":
                case "dam":
                case "d":
                    cmdDamage();
                    break;
                case "item":
                case "info":
                case "lookup":
                    cmdItem(args);
                    break;
                case "search":
                case "find":
                    cmdSearch(args);
                    break;
                case "boost":
                case "buff":
                case "boosts":
                    cmdBoost(args);
                    break;
                case "optimize":
                case "opt":
                    cmdOptimize();
                    break;
                case "link":
                case "export":
                case "url":
                    cmdLink();
                    break;
                case "import":
                case "load":
                    await cmdImport(args);
                    break;
                case "reset":
                case "new":
                    cmdReset();
                    break;
                case "clear":
                case "cls":
                    cmdClear();
                    break;
                case "history":
                    cmdHistory();
                    break;
                case "gui":
                    cmdGui();
                    break;
                default:
                    printLine(`Unknown command: '${escapeHtml(command)}'. Type <span class='term-line-info'>help</span> for available commands.`, "term-line-error");
                    break;
            }
        } catch (err) {
            console.error("CLI execution error:", err);
            printLine(`Command error: ${escapeHtml(err.message || String(err))}`, "term-line-error");
        }

        updatePrompt();
    }

    // =========================================================================
    // COMMAND IMPLEMENTATIONS
    // =========================================================================

    function cmdHelp(args) {
        if (args.length > 0) {
            const sub = args[0].toLowerCase();
            const helps = {
                "build": "Usage: build\nDisplays currently equipped gear, powders, skill points, set bonuses, and warnings.",
                "atree": "Usage: atree [summary | takable | list [filter] | toggle <name|id> | info <name|id> | reset]\nSubcommands:\n  atree                     Show ability tree summary (AP, archetypes, active/takable count)\n  atree takable             List ONLY the abilities currently takable based on your tree\n  atree list [filter]       List all class abilities (filter by: active, takable, archetype, text)\n  atree toggle <name|id>    Activate or deactivate an ability node (e.g. atree toggle Spin Attack)\n  atree take <name|id>      Activate an ability node\n  atree remove <name|id>    Deactivate an ability node\n  atree info <name|id>      Inspect ability details, AP cost, parent/child nodes, and requirements\n  atree reset               Clear/deactivate all ability tree nodes",
                "equip": "Usage: equip [slot] <item name> [powders]\nCategory is optional and automatically inferred from item name if omitted!\nExample: equip Morph-Stardust\nExample: equip Cataclysm t6t6t6\nExample: equip helmet Morph-Stardust\nExample: equip weapon Cataclysm -p t6t6t6\nSlots: helmet, chestplate, leggings, boots, ring1, ring2, ring, bracelet, necklace, weapon (or wand, bow, dagger, spear, relik)",
                "unequip": "Usage: unequip <slot | all>\nExample: unequip helmet\nExample: unequip all",
                "powder": "Usage: powder <slot> <powders>\nExample: powder weapon e6e6e6\nExample: powder chestplate w6w6",
                "level": "Usage: level <1-121>\nSets the character level and updates available skill points.",
                "sp": "Usage: sp [auto | reset | <str> <dex> <int> <def> <agi> | <stat> <value>]\nExample: sp auto (allocates exact minimum requirements)\nExample: sp 0 0 100 0 50\nExample: sp int 80",
                "stats": "Usage: stats [-d | --detailed]\nDisplays Health, Effective HP, Defenses, Mana regen/steal, and other build IDs.",
                "damage": "Usage: damage\nDisplays weapon damages, melee DPS, ability spell damages, and poison DPS.",
                "item": "Usage: item <item name>\nInspects full stats, rolls, requirements, and major IDs of any item in the database.",
                "search": "Usage: search [query] [-t <type>] [-r <rarity>] [-lvl <min-max>] [stat filters] [-sort <stat>] [-n <limit>]\nStat Filters: wDam>0, wDamPct>20, mr>=3, spd>10, slots>=2, strReq<=50, +mr, +wDam\nAliases: water damage > 0, mana regen >= 3, walk speed > 15, spell damage > 100\nExample: search -t wand wDam>0\nExample: search -t wand water damage > 0\nExample: search water damage\nExample: search -t ring mr>=3 spd>10\nExample: search -t dagger -r mythic\nExample: search -t bow -lvl 90-106 -sort wDam -n 10",
                "boost": "Usage: boost [warscream | totem | fortitude | emboldeningcry | judgement | clear]\nToggles combat damage & defense multipliers.",
                "optimize": "Usage: optimize\nRuns WynnBuilder's Str/Dex damage optimizer on your remaining unassigned skill points.",
                "link": "Usage: link\nDisplays the shareable WynnBuilder URL and copies it to your clipboard.",
                "import": "Usage: import <hash_or_url>\nLoads a build from a WynnBuilder URL or #8_... hash string.",
                "gui": "Usage: gui\nToggles between Terminal CLI view and classic Graphical UI view."
            };
            if (helps[sub]) {
                printLine(`<div class='term-box'><pre style='margin:0'>${escapeHtml(helps[sub])}</pre></div>`);
                return;
            }
        }

        const helpText = `
<div class='term-box'>
<b>WynnBuilder CLI Command Reference:</b>
<table class='term-table'>
  <tr><th style='width: 140px;'>Command</th><th>Description</th></tr>
  <tr><td><b class='term-line-info'>build</b> (b, show)</td><td>Display currently equipped build, skill points, and warnings</td></tr>
  <tr><td><b class='term-line-info'>atree</b> [subcmd]</td><td>Manage Ability Tree (<code>toggle &lt;name|id&gt;</code>, <code>takable</code>, <code>list</code>, <code>info</code>, <code>reset</code>)</td></tr>
  <tr><td><b class='term-line-info'>equip</b> [slot] &lt;item&gt;</td><td>Equip item (category optional, e.g. <code>equip Cataclysm t6t6t6</code> or <code>eq helmet Morph-Stardust</code>)</td></tr>
  <tr><td><b class='term-line-info'>unequip</b> &lt;slot|all&gt;</td><td>Unequip an item or clear all equipment</td></tr>
  <tr><td><b class='term-line-info'>powder</b> &lt;slot&gt; &lt;pow&gt;</td><td>Apply powders to equipment (e.g. <code>powder weapon t6t6t6</code>)</td></tr>
  <tr><td><b class='term-line-info'>level</b> &lt;1-121&gt;</td><td>Set player level (e.g. <code>level 106</code>)</td></tr>
  <tr><td><b class='term-line-info'>sp</b> [auto|stats]</td><td>View or set skill points (e.g. <code>sp auto</code> for min requirements)</td></tr>
  <tr><td><b class='term-line-info'>stats</b> [-d]</td><td>Display HP, Effective HP, Defenses, Mana stats, and Roll IDs</td></tr>
  <tr><td><b class='term-line-info'>damage</b> (dps)</td><td>Display Weapon damage, Melee DPS, Spell damages, and Poison</td></tr>
  <tr><td><b class='term-line-info'>item</b> &lt;name&gt;</td><td>Inspect stats, requirements, and identifications of any item</td></tr>
  <tr><td><b class='term-line-info'>search</b> &lt;query&gt;</td><td>Search items by name, type (<code>-t</code>), rarity (<code>-r</code>), level (<code>-lvl</code>), and stat filters (e.g. <code>wDam&gt;0</code>, <code>mr&gt;=3</code>, <code>water damage &gt; 0</code>)</td></tr>
  <tr><td><b class='term-line-info'>boost</b> [buff]</td><td>View or toggle buffs (Warscream, Totem, Fortitude, Judgement)</td></tr>
  <tr><td><b class='term-line-info'>optimize</b></td><td>Optimize remaining skill points between Str and Dex for max DPS</td></tr>
  <tr><td><b class='term-line-info'>link</b> (export)</td><td>Export shareable WynnBuilder URL and copy to clipboard</td></tr>
  <tr><td><b class='term-line-info'>import</b> &lt;hash&gt;</td><td>Load a build from a WynnBuilder link or hash</td></tr>
  <tr><td><b class='term-line-info'>reset</b></td><td>Reset build to blank state</td></tr>
  <tr><td><b class='term-line-info'>clear</b> (cls)</td><td>Clear terminal screen (or Ctrl+L)</td></tr>
  <tr><td><b class='term-line-info'>gui</b></td><td>Toggle between Terminal view and classic Graphical UI view</td></tr>
</table>
<i>Tip: Press <b>Tab</b> for command, slot, and item auto-completion. Use <b>Up/Down arrows</b> for history.</i>
</div>`;
        printLine(helpText);
    }

    function cmdBuild() {
        if (!player_build) {
            printLine("No active build found. Use <span class='term-line-info'>equip &lt;slot&gt; &lt;item&gt;</span> to start building!", "term-line-warn");
            return;
        }

        let out = "<div class='term-box'>";
        const wep = player_build.weapon;
        const wepType = wep ? wep.statMap.get("type") : "None";
        const playerClass = wep_to_class.has(wepType) ? wep_to_class.get(wepType) : "None";
        out += `<b>=== Player Build [Level ${player_build.level || 106} ${playerClass.toUpperCase()}] ===</b><br/>`;

        // Equipment Table
        out += "<table class='term-table'>";
        out += "<tr><th>Slot</th><th>Item Name</th><th>Powders</th><th>Requirements</th></tr>";

        for (let i = 0; i < equipment_fields.length; i++) {
            const slot = equipment_fields[i];
            const slotName = equipment_names[i];
            const itemInput = document.getElementById(slot + "-choice");
            const itemName = itemInput ? itemInput.value : "";
            const itemPowder = document.getElementById(slot + "-powder") ? document.getElementById(slot + "-powder").value : "";

            let displayName = itemName;
            let tierClass = "tier-normal";
            let reqsStr = "-";

            if (itemName && itemMap.has(itemName)) {
                const itemObj = itemMap.get(itemName);
                tierClass = getTierClass(itemObj.tier);
                displayName = `<span class='${tierClass}'>${escapeHtml(itemObj.displayName)}</span>`;
                
                let reqs = [];
                if (itemObj.lvl > 0) reqs.push(`Lvl ${itemObj.lvl}`);
                if (itemObj.strReq > 0) reqs.push(`${itemObj.strReq} Str`);
                if (itemObj.dexReq > 0) reqs.push(`${itemObj.dexReq} Dex`);
                if (itemObj.intReq > 0) reqs.push(`${itemObj.intReq} Int`);
                if (itemObj.defReq > 0) reqs.push(`${itemObj.defReq} Def`);
                if (itemObj.agiReq > 0) reqs.push(`${itemObj.agiReq} Agi`);
                if (reqs.length > 0) reqsStr = reqs.join(", ");
            } else if (!itemName || itemName.startsWith("No ")) {
                displayName = `<span class='term-line-system'>(Empty)</span>`;
            }

            const powderBadge = itemPowder ? `[<span class='elem-neutral'>${escapeHtml(itemPowder)}</span>]` : "-";
            out += `<tr><td><b>${slotName}</b></td><td>${displayName}</td><td>${powderBadge}</td><td><small>${reqsStr}</small></td></tr>`;
        }
        out += "</table>";

        // Skill points summary
        const spNames = ["Strength", "Dexterity", "Intelligence", "Defense", "Agility"];
        const spKeys = ["str", "dex", "int", "def", "agi"];
        out += "<div style='margin-top: 8px;'><b>Skill Points:</b> ";
        let spParts = [];
        for (let i = 0; i < 5; i++) {
            const base = parseInt(document.getElementById(spKeys[i] + "-skp")?.value) || 0;
            const total = stat_agg_node ? (stat_agg_node.value.get(spKeys[i]) || 0) : base;
            const diff = total - base;
            const bonusStr = diff !== 0 ? ` (${diff >= 0 ? "+" : ""}${diff})` : "";
            spParts.push(`<span class='elem-${getElemName(i)}'>${spNames[i]}: ${total}${bonusStr} [base: ${base}]</span>`);
        }
        out += spParts.join(" | ");
        out += "</div>";

        // Assigned vs Available
        const avail = player_build.availableSkillpoints;
        const assigned = player_build.assigned_skillpoints;
        const remaining = avail - assigned;
        const remClass = remaining < 0 ? "term-line-error" : "term-line-success";
        out += `<div>Assigned: <b>${assigned}</b> / ${avail} | Remaining: <b class='${remClass}'>${remaining}</b></div>`;

        // Active Set Bonuses
        if (player_build.activeSetCounts && player_build.activeSetCounts.size > 0) {
            let setList = [];
            for (const [setName, count] of player_build.activeSetCounts) {
                if (sets.has(setName) && !sets.get(setName).hidden) {
                    setList.push(`<span class='tier-set'>${setName} (${count}/${sets.get(setName).bonuses.length})</span>`);
                }
            }
            if (setList.length > 0) {
                out += `<div>Active Sets: ${setList.join(", ")}</div>`;
            }
        }

        // Ability Tree Summary
        if (playerClass !== "None" && typeof atree_node !== "undefined" && atree_node && atree_node.value && atree_node.value.length > 0) {
            const atreeAnalysis = getAtreeAnalysis();
            if (atreeAnalysis) {
                let archParts = [];
                for (const [arch, count] of atreeAnalysis.archetypeCount) {
                    archParts.push(`<span class='atree-arch-badge'>${escapeHtml(arch)} (${count})</span>`);
                }
                const archText = archParts.length > 0 ? archParts.join(" ") : "<span class='term-line-system'>None</span>";
                const apStatusClass = atreeAnalysis.apLeft < 0 ? "term-line-error" : "term-line-success";
                out += `<div style='margin-top: 6px;'><b>Ability Tree:</b> AP Assigned: <b>${atreeAnalysis.apUsed}</b> / ${atreeAnalysis.apCap} (<b class='${apStatusClass}'>${atreeAnalysis.apLeft}</b> left) | Active: <b>${atreeAnalysis.activeCount}</b> | Takable: <b class='term-line-info'>${atreeAnalysis.takableNodes.length}</b></div>`;
                out += `<div>&nbsp;&nbsp;Archetypes: ${archText}</div>`;
            }
        }

        // Warnings
        const warnings = getBuildWarnings();
        if (warnings.length > 0) {
            out += `<div style='margin-top: 6px; color: var(--term-warning);'><b>⚠ Build Warnings:</b><br/>`;
            for (const w of warnings) {
                out += `&nbsp;&nbsp;• ${escapeHtml(w)}<br/>`;
            }
            out += "</div>";
        }

        out += "</div>";
        printLine(out);
    }

    function getSlotFromItem(item) {
        if (!item) return null;
        if (item.category === "weapon" || ["bow", "spear", "wand", "dagger", "relik"].includes(item.type)) {
            return "weapon";
        }
        if (item.type === "ring") {
            const ring1Elem = document.getElementById("ring1-choice");
            const ring2Elem = document.getElementById("ring2-choice");
            const r1Empty = !ring1Elem || !ring1Elem.value || ring1Elem.value.startsWith("No ");
            const r2Empty = !ring2Elem || !ring2Elem.value || ring2Elem.value.startsWith("No ");
            if (r1Empty) return "ring1";
            if (r2Empty) return "ring2";
            return "ring1";
        }
        if (["helmet", "chestplate", "leggings", "boots", "bracelet", "necklace"].includes(item.type)) {
            return item.type;
        }
        return null;
    }

    function resolveRingSlot(slot) {
        if (slot === "ring") {
            const ring1Elem = document.getElementById("ring1-choice");
            const ring2Elem = document.getElementById("ring2-choice");
            const r1Empty = !ring1Elem || !ring1Elem.value || ring1Elem.value.startsWith("No ");
            const r2Empty = !ring2Elem || !ring2Elem.value || ring2Elem.value.startsWith("No ");
            if (r1Empty) return "ring1";
            if (r2Empty) return "ring2";
            return "ring1";
        }
        return slot;
    }

    function parseEquipArgs(tokens, slot = null) {
        let rest = tokens.slice();
        if (rest.length === 0) return { itemName: "", powderStr: "" };

        let powderStr = "";

        // 1. Check for explicit flags: -p <powders>, --powder <powders>, --powders <powders>
        for (let i = 0; i < rest.length; i++) {
            if ((rest[i] === "-p" || rest[i] === "--powder" || rest[i] === "--powders") && i + 1 < rest.length) {
                powderStr = rest[i + 1];
                rest.splice(i, 2);
                break;
            } else if (rest[i].startsWith("-p=")) {
                powderStr = rest[i].substring(3);
                rest.splice(i, 1);
                break;
            } else if (rest[i].toLowerCase().startsWith("powder:") || rest[i].toLowerCase().startsWith("powders:")) {
                powderStr = rest[i].split(":")[1];
                rest.splice(i, 1);
                break;
            }
        }

        // 2. If powder was not found via flag, check if any token is enclosed in brackets: e.g. [t6t6t6]
        if (!powderStr) {
            for (let i = 0; i < rest.length; i++) {
                if (rest[i].startsWith("[") && rest[i].endsWith("]")) {
                    powderStr = rest[i].slice(1, -1);
                    rest.splice(i, 1);
                    break;
                }
            }
        }

        // 3. If powder still not found, check if a prefix of rest matches an item in itemMap
        if (!powderStr && rest.length > 1) {
            const fullMatch = resolveItemExactOrCase(rest.join(" "), slot);
            if (!fullMatch) {
                for (let i = rest.length - 1; i >= 1; i--) {
                    const itemCandidate = rest.slice(0, i).join(" ");
                    const itemMatch = resolveItemExactOrCase(itemCandidate, slot);
                    if (itemMatch) {
                        powderStr = rest.slice(i).join("");
                        rest = rest.slice(0, i);
                        break;
                    }
                }
            }
        }

        // 4. If powder still not found, check if the last token looks like a powder pattern:
        // Matches e.g. e6, t6t6, f7f7f7, p7p7, etc.
        if (!powderStr && rest.length > 1) {
            const lastToken = rest[rest.length - 1];
            if (/^([etwfap][1-7]){1,7}$/i.test(lastToken)) {
                const candidateWithoutLast = rest.slice(0, -1).join(" ");
                if (resolveItem(candidateWithoutLast, slot)) {
                    powderStr = lastToken;
                    rest = rest.slice(0, -1);
                }
            }
        }

        if (powderStr) {
            powderStr = powderStr.replace(/[\[\], ]/g, "").toLowerCase();
        }

        const itemName = rest.join(" ").trim();
        return { itemName, powderStr };
    }

    function cmdEquip(args) {
        if (args.length === 0) {
            printLine("Usage: equip [slot] &lt;item name&gt; [powders]", "term-line-warn");
            printLine("Category is optional and automatically inferred from item name if omitted.", "term-line-system");
            printLine("Example: equip Morph-Stardust", "term-line-system");
            printLine("Example: equip Cataclysm t6t6t6", "term-line-system");
            printLine("Example: equip helmet Morph-Stardust", "term-line-system");
            printLine("Example: equip weapon Cataclysm -p t6t6t6", "term-line-system");
            return;
        }

        let explicitSlot = null;
        let itemTokens = [];
        let categoryInferred = false;

        const firstLower = args[0].toLowerCase();
        const potentialSlot = SLOT_ALIASES[firstLower] || (VALID_EQUIP_SLOTS.includes(firstLower) ? firstLower : null);

        if (potentialSlot && args.length >= 2) {
            // Check if the entire argument string matches an item whose full name starts with args[0]
            // e.g. "Helm Splitter", "Chest Breaker", "Ring of Fire", "Bow of Wisdom"
            const fullParse = parseEquipArgs(args);
            const fullMatch = fullParse.itemName ? resolveItemExactOrCase(fullParse.itemName) : null;

            if (fullMatch && fullMatch.displayName.toLowerCase().startsWith(firstLower)) {
                explicitSlot = null;
                itemTokens = args;
                categoryInferred = true;
            } else {
                explicitSlot = potentialSlot;
                itemTokens = args.slice(1);
            }
        } else if (potentialSlot && args.length === 1) {
            printLine(`Item name cannot be empty. Usage: equip ${args[0]} &lt;item name&gt; [powders]`, "term-line-warn");
            return;
        } else {
            explicitSlot = null;
            itemTokens = args;
            categoryInferred = true;
        }

        const { itemName, powderStr } = parseEquipArgs(itemTokens, explicitSlot);
        if (!itemName) {
            printLine("Item name cannot be empty.", "term-line-warn");
            return;
        }

        // Find best match in itemMap
        const matchedItem = resolveItem(itemName, explicitSlot);
        if (!matchedItem) {
            printLine(`Item '${escapeHtml(itemName)}' not found in database.`, "term-line-error");
            return;
        }

        // Determine target slot
        let targetSlot = explicitSlot;
        if (!targetSlot) {
            targetSlot = getSlotFromItem(matchedItem);
            if (!targetSlot) {
                printLine(`Could not infer equipment slot for item '${escapeHtml(matchedItem.displayName)}'.`, "term-line-error");
                return;
            }
        }

        // If slot is "ring", choose between ring1 and ring2
        targetSlot = resolveRingSlot(targetSlot);

        if (!equipment_fields.includes(targetSlot)) {
            printLine(`Invalid slot '${escapeHtml(targetSlot)}'. Valid slots: ${equipment_fields.join(", ")}`, "term-line-error");
            return;
        }

        // Update DOM input to trigger the computation graph
        const choiceInput = document.getElementById(targetSlot + "-choice");
        if (choiceInput) {
            choiceInput.value = matchedItem.displayName;
            choiceInput.dispatchEvent(new Event("change"));
        }

        // Apply powders if provided or clear previous powders if slot supports powders
        const powderInputId = targetSlot + "-powder";
        if (powder_inputs.includes(powderInputId)) {
            const powderInput = document.getElementById(powderInputId);
            if (powderInput) {
                powderInput.value = powderStr;
                powderInput.dispatchEvent(new Event("change"));
            }

            if (powderStr) {
                // Check for unknown powder codes
                let invalidTokens = [];
                let p = powderStr;
                while (p.length >= 2) {
                    const tok = p.slice(0, 2);
                    if (typeof powderIDs !== "undefined" && !powderIDs.has(tok)) {
                        invalidTokens.push(tok);
                    }
                    p = p.slice(2);
                }
                if (invalidTokens.length > 0) {
                    printLine(`⚠ Note: Unknown powder code(s): ${invalidTokens.map(t => "'" + t + "'").join(", ")}. Valid powders are e, t, w, f, a with tiers 1-7 (e.g. t6, e7, w6).`, "term-line-warn");
                }
            }
        } else if (powderStr) {
            printLine(`Note: Slot <b>${targetSlot}</b> does not support powders.`, "term-line-system");
        }

        const tierClass = getTierClass(matchedItem.tier);
        let msg = `Equipped <span class='${tierClass}'>[${escapeHtml(matchedItem.displayName)}]</span> to <b>${targetSlot}</b>${categoryInferred ? ` (category inferred: <b>${matchedItem.type}</b>)` : ""}.`;
        if (powderStr) msg += ` Powders: [<span class='elem-neutral'>${escapeHtml(powderStr)}</span>]`;
        printLine(msg, "term-line-success");

        // Check warnings
        const warnings = getBuildWarnings();
        if (warnings.length > 0) {
            printLine(`⚠ Notice: ${escapeHtml(warnings[0])}`, "term-line-warn");
        }
    }

    function cmdUnequip(args) {
        if (args.length === 0) {
            printLine("Usage: unequip &lt;slot | all&gt;", "term-line-warn");
            return;
        }

        const slotArg = args[0].toLowerCase();
        if (slotArg === "all") {
            for (const slot of equipment_fields) {
                const choiceInput = document.getElementById(slot + "-choice");
                if (choiceInput) {
                    choiceInput.value = "";
                    choiceInput.dispatchEvent(new Event("change"));
                }
                const powderInput = document.getElementById(slot + "-powder");
                if (powderInput) {
                    powderInput.value = "";
                    powderInput.dispatchEvent(new Event("change"));
                }
            }
            printLine("All equipment unequipped.", "term-line-success");
            return;
        }

        const slot = SLOT_ALIASES[slotArg] || slotArg;
        if (!equipment_fields.includes(slot)) {
            printLine(`Invalid slot '${escapeHtml(slotArg)}'. Valid slots: ${equipment_fields.join(", ")}`, "term-line-error");
            return;
        }

        const choiceInput = document.getElementById(slot + "-choice");
        if (choiceInput) {
            choiceInput.value = "";
            choiceInput.dispatchEvent(new Event("change"));
        }
        const powderInput = document.getElementById(slot + "-powder");
        if (powderInput) {
            powderInput.value = "";
            powderInput.dispatchEvent(new Event("change"));
        }

        printLine(`Unequipped <b>${slot}</b>.`, "term-line-success");
    }

    function cmdPowder(args) {
        if (args.length < 2) {
            printLine("Usage: powder &lt;slot&gt; &lt;powders&gt;", "term-line-warn");
            printLine("Example: powder weapon e6e6e6", "term-line-system");
            printLine("Example: powder helmet w6w6", "term-line-system");
            return;
        }

        const slotArg = args[0].toLowerCase();
        const slot = SLOT_ALIASES[slotArg] || slotArg;
        const powderInputId = slot + "-powder";

        if (!powder_inputs.includes(powderInputId)) {
            printLine(`Slot '${escapeHtml(slotArg)}' does not support powders. Valid powderable slots: helmet, chestplate, leggings, boots, weapon.`, "term-line-error");
            return;
        }

        const powderStr = args.slice(1).join("").replace(/[\[\], ]/g, "").toLowerCase().trim();
        const powderInput = document.getElementById(powderInputId);
        if (powderInput) {
            powderInput.value = powderStr;
            powderInput.dispatchEvent(new Event("change"));
            printLine(`Applied powders [<span class='elem-neutral'>${escapeHtml(powderStr)}</span>] to <b>${slot}</b>.`, "term-line-success");

            // Check for unknown powder codes
            let invalidTokens = [];
            let p = powderStr;
            while (p.length >= 2) {
                const tok = p.slice(0, 2);
                if (typeof powderIDs !== "undefined" && !powderIDs.has(tok)) {
                    invalidTokens.push(tok);
                }
                p = p.slice(2);
            }
            if (invalidTokens.length > 0) {
                printLine(`⚠ Note: Unknown powder code(s): ${invalidTokens.map(t => "'" + t + "'").join(", ")}. Valid powders are e, t, w, f, a with tiers 1-7 (e.g. t6, e7, w6).`, "term-line-warn");
            }
        }
    }

    function cmdLevel(args) {
        if (args.length === 0) {
            const curLvl = player_build ? player_build.level : document.getElementById("level-choice")?.value || 106;
            printLine(`Current player level: <b>${curLvl}</b>`, "term-line-info");
            return;
        }

        const lvl = parseInt(args[0]);
        if (isNaN(lvl) || lvl < 1 || lvl > 121) {
            printLine("Level must be an integer between 1 and 121.", "term-line-error");
            return;
        }

        const lvlInput = document.getElementById("level-choice");
        if (lvlInput) {
            lvlInput.value = lvl;
            lvlInput.dispatchEvent(new Event("change"));
            const maxSP = levelToSkillPoints(lvl);
            printLine(`Level set to <b>${lvl}</b>. Available Skill Points: <b>${maxSP}</b>.`, "term-line-success");
        }
    }

    function cmdSkillPoints(args) {
        if (!player_build) {
            printLine("No active build found.", "term-line-warn");
            return;
        }

        const spKeys = ["str", "dex", "int", "def", "agi"];

        if (args.length === 0) {
            // Display Skill Points table
            let out = "<div class='term-box'><b>Skill Points Breakdown:</b><table class='term-table'>";
            out += "<tr><th>Attribute</th><th>Base Assigned</th><th>Gear Bonus</th><th>Total</th></tr>";
            const spNames = ["Strength", "Dexterity", "Intelligence", "Defense", "Agility"];
            for (let i = 0; i < 5; i++) {
                const base = parseInt(document.getElementById(spKeys[i] + "-skp")?.value) || 0;
                const total = stat_agg_node ? (stat_agg_node.value.get(spKeys[i]) || 0) : base;
                const bonus = total - base;
                out += `<tr><td><b class='elem-${getElemName(i)}'>${spNames[i]}</b></td><td>${base}</td><td>${bonus >= 0 ? "+" : ""}${bonus}</td><td><b>${total}</b></td></tr>`;
            }
            out += "</table>";
            out += `Assigned: <b>${player_build.assigned_skillpoints}</b> / ${player_build.availableSkillpoints} | Remaining: <b>${player_build.availableSkillpoints - player_build.assigned_skillpoints}</b></div>`;
            printLine(out);
            return;
        }

        const sub = args[0].toLowerCase();

        // Auto allocate minimum required skill points
        if (sub === "auto" || sub === "min") {
            const minReqs = player_build.base_skillpoints;
            if (!minReqs) {
                printLine("Cannot auto-allocate skillpoints: build is not ready.", "term-line-error");
                return;
            }
            for (let i = 0; i < 5; i++) {
                const elem = document.getElementById(spKeys[i] + "-skp");
                if (elem) {
                    elem.value = minReqs[i];
                    elem.dispatchEvent(new Event("change"));
                }
            }
            printLine(`Auto-allocated minimum skill points: Str: ${minReqs[0]}, Dex: ${minReqs[1]}, Int: ${minReqs[2]}, Def: ${minReqs[3]}, Agi: ${minReqs[4]}.`, "term-line-success");
            return;
        }

        // Reset to 0
        if (sub === "reset") {
            for (let i = 0; i < 5; i++) {
                const elem = document.getElementById(spKeys[i] + "-skp");
                if (elem) {
                    elem.value = 0;
                    elem.dispatchEvent(new Event("change"));
                }
            }
            printLine("Reset base skill points to 0.", "term-line-success");
            return;
        }

        // 5 numbers provided: sp 0 0 100 0 50
        if (args.length === 5 && args.every(x => !isNaN(parseInt(x)))) {
            for (let i = 0; i < 5; i++) {
                const val = Math.max(0, parseInt(args[i]));
                const elem = document.getElementById(spKeys[i] + "-skp");
                if (elem) {
                    elem.value = val;
                    elem.dispatchEvent(new Event("change"));
                }
            }
            printLine(`Skill points set to Str: ${args[0]}, Dex: ${args[1]}, Int: ${args[2]}, Def: ${args[3]}, Agi: ${args[4]}.`, "term-line-success");
            return;
        }

        // Setting single attribute: sp int 80
        if (args.length === 2 && spKeys.includes(sub)) {
            const val = Math.max(0, parseInt(args[1]));
            const elem = document.getElementById(sub + "-skp");
            if (elem) {
                elem.value = val;
                elem.dispatchEvent(new Event("change"));
                printLine(`Set base <b>${sub.toUpperCase()}</b> to <b>${val}</b>.`, "term-line-success");
            }
            return;
        }

        printLine("Usage: sp [auto | reset | &lt;str&gt; &lt;dex&gt; &lt;int&gt; &lt;def&gt; &lt;agi&gt; | &lt;stat&gt; &lt;value&gt;]", "term-line-warn");
    }

    function cmdStats(args) {
        if (!stat_agg_node || !player_build) {
            printLine("No active build found to calculate stats.", "term-line-warn");
            return;
        }

        const stats = stat_agg_node.value;
        const detailed = args.includes("-d") || args.includes("--detailed");

        // Use getDefenseStats
        const defStats = getDefenseStats(stats);
        // defStats: [total hp, [ehp w/ agi, ehp w/o agi], total hpr, [ehpr w/ agi, ehpr w/o agi], [def%, agi%], [edef,tdef,wdef,fdef,adef]]
        const totalHp = defStats[0];
        const ehpAgi = Math.round(defStats[1][0]);
        const ehpNoAgi = Math.round(defStats[1][1]);
        const totalHpr = Math.round(defStats[2]);
        const defPct = Math.round(defStats[4][0]);
        const agiPct = Math.round(defStats[4][1]);
        const eleDefs = defStats[5];

        let out = "<div class='term-box'>";
        out += "<b>=== Defensive & Survivability Stats ===</b><br/>";
        out += `<table class='term-table'>`;
        out += `<tr><td>Health:</td><td><b class='tier-fabled'>${totalHp} HP</b></td><td>Health Regen:</td><td><b>${totalHpr}</b> (raw: ${stats.get("hprRaw") || 0}, ${stats.get("hprPct") || 0}%)</td></tr>`;
        out += `<tr><td>Effective HP:</td><td><b class='term-line-success'>${ehpAgi.toLocaleString()}</b> (w/ Agility)</td><td>Defense / Agi %:</td><td>${defPct}% / ${agiPct}%</td></tr>`;
        out += `<tr><td>Effective HP (no agi):</td><td><b>${ehpNoAgi.toLocaleString()}</b></td><td>EHP Regen:</td><td><b>${Math.round(defStats[3][0]).toLocaleString()}</b></td></tr>`;
        out += `</table>`;

        out += "<div style='margin-top: 6px;'><b>Elemental Defenses:</b><br/>";
        out += `&nbsp;&nbsp;<span class='elem-earth'>Earth: ${Math.round(eleDefs[0])}</span> | `;
        out += `<span class='elem-thunder'>Thunder: ${Math.round(eleDefs[1])}</span> | `;
        out += `<span class='elem-water'>Water: ${Math.round(eleDefs[2])}</span> | `;
        out += `<span class='elem-fire'>Fire: ${Math.round(eleDefs[3])}</span> | `;
        out += `<span class='elem-air'>Air: ${Math.round(eleDefs[4])}</span>`;
        out += "</div>";

        // Mana Stats
        out += "<div style='margin-top: 8px;'><b>=== Mana & Sustain ===</b><table class='term-table'>";
        const mr = stats.get("mr") || 0;
        const ms = stats.get("ms") || 0;
        const netMana = document.getElementById("net-mana")?.textContent || "-";
        const manaUsed = document.getElementById("mana-used")?.textContent || "-";
        out += `<tr><td>Mana Regen:</td><td><b>${mr}/5s</b></td><td>Mana Steal:</td><td><b>${ms}/3s</b></td></tr>`;
        out += `<tr><td>Net Mana/s:</td><td><b>${netMana}</b></td><td>Mana Used/s:</td><td><b>${manaUsed}</b></td></tr>`;
        out += `</table></div>`;

        // Movement & Utility
        out += "<div style='margin-top: 8px;'><b>=== Utility & IDs ===</b><table class='term-table'>";
        const speed = stats.get("speed") || 0;
        const ls = stats.get("ls") || 0;
        const exp = stats.get("exp") || 0;
        const poison = stats.get("poison") || 0;
        const spRegen = stats.get("spRegen") || 0;
        const thorns = stats.get("thorns") || 0;
        const ref = stats.get("ref") || 0;

        out += `<tr><td>Walk Speed:</td><td><b>${speed >= 0 ? "+" : ""}${speed}%</b></td><td>Life Steal:</td><td><b>${ls}/3s</b></td></tr>`;
        out += `<tr><td>Poison:</td><td><b>${poison}/3s</b></td><td>Exploding:</td><td><b>${exp}%</b></td></tr>`;
        // out += `<tr><td>Soul Point Regen:</td><td><b>${spRegen}%</b></td><td>Thorns / Reflection:</td><td><b>${thorns}% / ${ref}%</b></td></tr>`;
        out += `</table></div>`;

        if (detailed) {
            out += "<div style='margin-top: 8px;'><b>=== Detailed Identifications ===</b><br/>";
            let idsList = [];
            for (const [k, v] of stats.entries()) {
                if (typeof v === "number" && v !== 0 && !["hp", "classDef"].includes(k)) {
                    idsList.push(`${k}: ${v}`);
                }
            }
            out += `<small style='color: var(--term-muted);'>${idsList.join(" | ")}</small></div>`;
        }

        out += "</div>";
        printLine(out);
    }

    function cmdDamage() {
        if (!player_build || !player_build.weapon) {
            printLine("No weapon equipped. Equip a weapon first with <span class='term-line-info'>equip weapon &lt;name&gt;</span>.", "term-line-warn");
            return;
        }

        const wep = player_build.weapon;
        const stats = stat_agg_node.value;
        const wepName = wep.statMap.get("displayName") || "None";
        const atkSpd = stats.get("atkSpd") || wep.statMap.get("atkSpd") || "NORMAL";

        let out = "<div class='term-box'>";
        out += `<b>=== Damage Calculation [${escapeHtml(wepName)}] ===</b><br/>`;
        out += `Attack Speed: <b>${escapeHtml(atkSpd)}</b><br/>`;

        // Weapon Base Damages
        out += "<table class='term-table'>";
        out += "<tr><th>Type</th><th>Base Damage</th></tr>";
        const damTypes = [
            ["Neutral", "nDam", "neutral"],
            ["Earth", "eDam", "earth"],
            ["Thunder", "tDam", "thunder"],
            ["Water", "wDam", "water"],
            ["Fire", "fDam", "fire"],
            ["Air", "aDam", "air"]
        ];
        for (const [label, key, elem] of damTypes) {
            const damVal = wep.statMap.get(key);
            if (damVal && damVal !== "0-0") {
                out += `<tr><td><span class='elem-${elem}'>${label}</span></td><td><b>${damVal}</b></td></tr>`;
            }
        }
        out += "</table>";

        // Spells & Abilities from DOM display
        out += "<div style='margin-top: 8px;'><b>Abilities & Spell Damages:</b><br/>";
        const spellIds = [0, 1, 2, 3, 4];
        let hasSpells = false;

        for (const idx of spellIds) {
            const spellElem = document.getElementById("spell" + idx + "-infoAvg");
            if (spellElem && spellElem.textContent.trim() && !spellElem.textContent.includes("Input a weapon")) {
                hasSpells = true;
                const cleanText = spellElem.innerText.replace(/\n\s*\n/g, '\n').trim();
                out += `<div style='background: rgba(0,0,0,0.25); padding: 4px 8px; border-radius: 4px; margin: 4px 0;'>`;
                out += `<pre style='margin: 0; font-family: inherit;'>${escapeHtml(cleanText)}</pre></div>`;
            }
        }

        if (!hasSpells) {
            out += "<i>Equip a valid weapon and ability tree to calculate spell damages.</i><br/>";
        }
        out += "</div>";

        // Poison
        const poison = stats.get("poison") || 0;
        if (poison > 0) {
            out += `<div style='margin-top: 6px; color: var(--elem-earth);'>Poison Damage: <b>${poison}</b> per 3 seconds</div>`;
        }

        out += "</div>";
        printLine(out);
    }

    function cmdItem(args) {
        if (args.length === 0) {
            printLine("Usage: item &lt;item name&gt;", "term-line-warn");
            printLine("Example: item Cataclysm", "term-line-system");
            printLine("Example: item Morph-Stardust", "term-line-system");
            return;
        }

        const query = args.join(" ").trim();
        const itemObj = resolveItem(query);

        if (!itemObj) {
            printLine(`Item '${escapeHtml(query)}' not found in database.`, "term-line-error");
            return;
        }

        const tierClass = getTierClass(itemObj.tier);
        let out = "<div class='term-box'>";
        out += `<b class='${tierClass}' style='font-size: 15px;'>${escapeHtml(itemObj.displayName)}</b><br/>`;
        out += `<span style='color: var(--term-muted);'>${itemObj.tier} ${itemObj.type}</span><br/>`;

        // Requirements
        out += "<div style='margin: 6px 0;'><b>Requirements:</b> ";
        let reqs = [];
        if (itemObj.lvl > 0) reqs.push(`Level ${itemObj.lvl}`);
        if (itemObj.strReq > 0) reqs.push(`${itemObj.strReq} Str`);
        if (itemObj.dexReq > 0) reqs.push(`${itemObj.dexReq} Dex`);
        if (itemObj.intReq > 0) reqs.push(`${itemObj.intReq} Int`);
        if (itemObj.defReq > 0) reqs.push(`${itemObj.defReq} Def`);
        if (itemObj.agiReq > 0) reqs.push(`${itemObj.agiReq} Agi`);
        out += (reqs.length > 0 ? reqs.join(", ") : "None") + "</div>";

        // Base Damages / Defenses
        out += "<table class='term-table'>";
        if (itemObj.category === "weapon") {
            out += `<tr><td>Attack Speed:</td><td><b>${itemObj.atkSpd || "NORMAL"}</b></td></tr>`;
            if (itemObj.nDam !== "0-0") out += `<tr><td><span class='elem-neutral'>Neutral Damage:</span></td><td><b>${itemObj.nDam}</b></td></tr>`;
            if (itemObj.eDam !== "0-0") out += `<tr><td><span class='elem-earth'>Earth Damage:</span></td><td><b>${itemObj.eDam}</b></td></tr>`;
            if (itemObj.tDam !== "0-0") out += `<tr><td><span class='elem-thunder'>Thunder Damage:</span></td><td><b>${itemObj.tDam}</b></td></tr>`;
            if (itemObj.wDam !== "0-0") out += `<tr><td><span class='elem-water'>Water Damage:</span></td><td><b>${itemObj.wDam}</b></td></tr>`;
            if (itemObj.fDam !== "0-0") out += `<tr><td><span class='elem-fire'>Fire Damage:</span></td><td><b>${itemObj.fDam}</b></td></tr>`;
            if (itemObj.aDam !== "0-0") out += `<tr><td><span class='elem-air'>Air Damage:</span></td><td><b>${itemObj.aDam}</b></td></tr>`;
        } else if (itemObj.category === "armor") {
            if (itemObj.hp > 0) out += `<tr><td>Health:</td><td><b class='tier-fabled'>+${itemObj.hp}</b></td></tr>`;
            if (itemObj.eDef !== 0) out += `<tr><td><span class='elem-earth'>Earth Defense:</span></td><td><b>${itemObj.eDef}</b></td></tr>`;
            if (itemObj.tDef !== 0) out += `<tr><td><span class='elem-thunder'>Thunder Defense:</span></td><td><b>${itemObj.tDef}</b></td></tr>`;
            if (itemObj.wDef !== 0) out += `<tr><td><span class='elem-water'>Water Defense:</span></td><td><b>${itemObj.wDef}</b></td></tr>`;
            if (itemObj.fDef !== 0) out += `<tr><td><span class='elem-fire'>Fire Defense:</span></td><td><b>${itemObj.fDef}</b></td></tr>`;
            if (itemObj.aDef !== 0) out += `<tr><td><span class='elem-air'>Air Defense:</span></td><td><b>${itemObj.aDef}</b></td></tr>`;
        }
        if (itemObj.slots > 0) {
            out += `<tr><td>Powder Slots:</td><td><b>${itemObj.slots}</b></td></tr>`;
        }
        out += "</table>";

        // Identifications / Rolls
        const statMap = expandItem(itemObj);
        const minRolls = statMap.get("minRolls");
        const maxRolls = statMap.get("maxRolls");

        if (maxRolls && maxRolls.size > 0) {
            out += "<div style='margin-top: 6px;'><b>Identifications:</b><table class='term-table'>";
            out += "<tr><th>Identification</th><th>Range [Min to Max]</th></tr>";
            for (const [id, maxVal] of maxRolls.entries()) {
                const minVal = minRolls.get(id);
                const prefix = idPrefixes[id] || id;
                const baseVal = statMap.get(id) || 0; // Unused atm
                if(minVal === 0 && maxVal === 0 && baseVal === 0) continue;
                out += `<tr><td>${prefix}</td><td>${minVal} to ${maxVal}</td></tr>`;
            }
            out += "</table></div>";
        }

        // Major IDs
        if (itemObj.majorIds && itemObj.majorIds.length > 0) {
            out += "<div style='margin-top: 6px;'><b>Major Identifications:</b><br/>";
            for (const mid of itemObj.majorIds) {
                out += `&nbsp;&nbsp;★ <b class='tier-legendary'>${mid}</b><br/>`;
            }
            out += "</div>";
        }

        // Set
        if (itemObj.set) {
            out += `<div style='margin-top: 6px;'>Part of Set: <b class='tier-set'>${itemObj.set}</b></div>`;
        }

        out += "</div>";
        printLine(out);
    }

    const SEARCH_TYPE_ALIASES = {
        "h": "helmet", "helm": "helmet", "helmet": "helmet",
        "c": "chestplate", "chest": "chestplate", "chestplate": "chestplate",
        "l": "leggings", "legs": "leggings", "leggings": "leggings",
        "b": "boots", "boot": "boots", "boots": "boots",
        "r": "ring", "ring": "ring", "rings": "ring", "r1": "ring", "r2": "ring",
        "br": "bracelet", "brace": "bracelet", "bracelet": "bracelet",
        "n": "necklace", "neck": "necklace", "necklace": "necklace",
        "w": "weapon", "wep": "weapon", "weapon": "weapon",
        "wand": "wand", "bow": "bow", "dagger": "dagger", "spear": "spear", "relik": "relik",
        "armor": "armor", "accessory": "accessory", "acc": "accessory"
    };

    const STAT_ALIASES = {
        "wdam": "wDam", "waterdamage": "wDam", "waterdam": "wDam", "wdmg": "wDam", "water": "wDam",
        "wdampct": "wDamPct", "waterdampct": "wDamPct", "waterdamagepct": "wDamPct", "water%": "wDamPct", "waterdmg%": "wDamPct",
        "wdamraw": "wDamRaw", "waterdamraw": "wDamRaw", "waterdamageraw": "wDamRaw", "wdmgraw": "wDamRaw",
        "wbase": "wBase", "wbasedam": "wBase", "wbasedamage": "wBase",
        "wsdpct": "wSdPct", "waterspelldamage%": "wSdPct", "waterspelldamagepct": "wSdPct",
        "wsdraw": "wSdRaw", "waterspelldamageraw": "wSdRaw",
        "wmdpct": "wMdPct", "watermeleedamage%": "wMdPct", "watermeleedamagepct": "wMdPct",
        "wmdraw": "wMdRaw", "watermeleedamageraw": "wMdRaw",
        "wdef": "wDef", "waterdefense": "wDef", "waterdef": "wDef",
        "wdefpct": "wDefPct", "waterdefense%": "wDefPct", "waterdef%": "wDefPct",

        "edam": "eDam", "earthdamage": "eDam", "earthdam": "eDam", "edmg": "eDam", "earth": "eDam",
        "edampct": "eDamPct", "earthdampct": "eDamPct", "earthdamagepct": "eDamPct", "earth%": "eDamPct",
        "edamraw": "eDamRaw", "earthdamraw": "eDamRaw", "earthdamageraw": "eDamRaw",
        "ebase": "eBase", "esdpct": "eSdPct", "esdraw": "eSdRaw", "emdpct": "eMdPct", "emdraw": "eMdRaw",
        "edef": "eDef", "edefpct": "eDefPct",

        "tdam": "tDam", "thunderdamage": "tDam", "thunderdam": "tDam", "tdmg": "tDam", "thunder": "tDam",
        "tdampct": "tDamPct", "thunderdampct": "tDamPct", "thunderdamagepct": "tDamPct", "thunder%": "tDamPct",
        "tdamraw": "tDamRaw", "thunderdamraw": "tDamRaw", "thunderdamageraw": "tDamRaw",
        "tbase": "tBase", "tsdpct": "tSdPct", "tsdraw": "tSdRaw", "tmdpct": "tMdPct", "tmdraw": "tMdRaw",
        "tdef": "tDef", "tdefpct": "tDefPct",

        "fdam": "fDam", "firedamage": "fDam", "firedam": "fDam", "fdmg": "fDam", "fire": "fDam",
        "fdampct": "fDamPct", "firedampct": "fDamPct", "firedamagepct": "fDamPct", "fire%": "fDamPct",
        "fdamraw": "fDamRaw", "firedamraw": "fDamRaw", "firedamageraw": "fDamRaw",
        "fbase": "fBase", "fsdpct": "fSdPct", "fsdraw": "fSdRaw", "fmdpct": "fMdPct", "fmdraw": "fMdRaw",
        "fdef": "fDef", "fdefpct": "fDefPct",

        "adam": "aDam", "airdamage": "aDam", "airdam": "aDam", "admg": "aDam", "air": "aDam",
        "adampct": "aDamPct", "airdampct": "aDamPct", "airdamagepct": "aDamPct", "air%": "aDamPct",
        "adamraw": "aDamRaw", "airdamraw": "aDamRaw", "airdamageraw": "aDamRaw",
        "abase": "aBase", "asdpct": "aSdPct", "asdraw": "aSdRaw", "amdpct": "aMdPct", "amdraw": "aMdRaw",
        "adef": "aDef", "adefpct": "aDefPct",

        "ndam": "nDam", "neutraldamage": "nDam", "neutraldam": "nDam", "neutral": "nDam",
        "ndampct": "nDamPct", "ndamraw": "nDamRaw", "nbase": "nBase",
        "nsdpct": "nSdPct", "nsdraw": "nSdRaw", "nmdpct": "nMdPct", "nmdraw": "nMdRaw",

        "dampct": "damPct", "damage%": "damPct", "dmg%": "damPct",
        "damraw": "damRaw", "damageraw": "damRaw",
        "rdampct": "rDamPct", "elemdamage%": "rDamPct", "rdamraw": "rDamRaw",
        "sdpct": "sdPct", "spelldamage%": "sdPct", "spelldmg%": "sdPct", "sd": "sdPct",
        "sdraw": "sdRaw", "rawspelldamage": "sdRaw",
        "mdpct": "mdPct", "meleedamage%": "mdPct", "meleedmg%": "mdPct", "md": "mdPct",
        "mdraw": "mdRaw", "rawmeleedamage": "mdRaw",
        "crit": "critDamPct", "critdampct": "critDamPct", "critdamage": "critDamPct",

        "hp": "hp", "health": "hp", "hpbonus": "hpBonus", "healthbonus": "hpBonus",
        "mr": "mr", "manaregen": "mr", "ms": "ms", "manasteal": "ms",
        "hpr": "hprRaw", "hprraw": "hprRaw", "healthregen": "hprRaw", "rawhealthregen": "hprRaw",
        "hprpct": "hprPct", "healthregen%": "hprPct",
        "ls": "ls", "lifesteal": "ls", "healpct": "healPct", "healing": "healPct",

        "spd": "spd", "speed": "spd", "walkspeed": "spd",
        "poison": "poison", "thorns": "thorns", "ref": "ref", "reflection": "ref",
        "expd": "expd", "exploding": "expd",
        "atktier": "atkTier", "attackspeed": "atkTier", "atkspd": "atkTier",
        "slots": "slots", "powderslots": "slots",
        "xpb": "xpb", "xp": "xpb", "lb": "lb", "loot": "lb", "lootbonus": "lb", "lq": "lq", "lootquality": "lq",
        "sprint": "sprint", "sprintreg": "sprintReg", "jh": "jh", "jumpheight": "jh",

        "str": "str", "dex": "dex", "int": "int", "def": "def", "agi": "agi",
        "strreq": "strReq", "dexreq": "dexReq", "intreq": "intReq", "defreq": "defReq", "agireq": "agiReq",
        "lvl": "lvl", "level": "lvl",
        "major": "majorIds", "majorid": "majorIds", "mid": "majorIds", "majorids": "majorIds",
        "set": "set", "class": "classReq", "classreq": "classReq"
    };

    const STAT_DISPLAY_NAMES = {
        "wDam": "Water Dam", "wDamPct": "Water Dam %", "wDamRaw": "Water Dam Raw", "wBase": "Water Base",
        "wSdPct": "Water Spell %", "wMdPct": "Water Melee %", "wDef": "Water Def", "wDefPct": "Water Def %",
        "eDam": "Earth Dam", "eDamPct": "Earth Dam %", "eDamRaw": "Earth Dam Raw", "eBase": "Earth Base",
        "eSdPct": "Earth Spell %", "eMdPct": "Earth Melee %", "eDef": "Earth Def", "eDefPct": "Earth Def %",
        "tDam": "Thunder Dam", "tDamPct": "Thunder Dam %", "tDamRaw": "Thunder Dam Raw", "tBase": "Thunder Base",
        "tSdPct": "Thunder Spell %", "tMdPct": "Thunder Melee %", "tDef": "Thunder Def", "tDefPct": "Thunder Def %",
        "fDam": "Fire Dam", "fDamPct": "Fire Dam %", "fDamRaw": "Fire Dam Raw", "fBase": "Fire Base",
        "fSdPct": "Fire Spell %", "fMdPct": "Fire Melee %", "fDef": "Fire Def", "fDefPct": "Fire Def %",
        "aDam": "Air Dam", "aDamPct": "Air Dam %", "aDamRaw": "Air Dam Raw", "aBase": "Air Base",
        "aSdPct": "Air Spell %", "aMdPct": "Air Melee %", "aDef": "Air Def", "aDefPct": "Air Def %",
        "nDam": "Neutral Dam", "nDamPct": "Neutral Dam %", "nDamRaw": "Neutral Dam Raw", "nBase": "Neutral Base",
        "damPct": "Damage %", "damRaw": "Damage Raw", "rDamPct": "Elem Dam %", "rDamRaw": "Elem Dam Raw",
        "sdPct": "Spell Dam %", "sdRaw": "Spell Dam Raw", "mdPct": "Melee Dam %", "mdRaw": "Melee Dam Raw",
        "critDamPct": "Crit Dam %",
        "hp": "Health", "hpBonus": "Health Bonus", "mr": "Mana Regen", "ms": "Mana Steal",
        "hprRaw": "Health Regen", "hprPct": "Health Regen %", "ls": "Life Steal", "healPct": "Healing %",
        "spd": "Walk Speed", "poison": "Poison", "thorns": "Thorns", "ref": "Reflection",
        "expd": "Exploding", "atkTier": "Attack Speed", "slots": "Slots",
        "xpb": "XP Bonus", "lb": "Loot Bonus", "lq": "Loot Quality",
        "str": "Strength", "dex": "Dexterity", "int": "Intelligence", "def": "Defense", "agi": "Agility",
        "strReq": "Str Req", "dexReq": "Dex Req", "intReq": "Int Req", "defReq": "Def Req", "agiReq": "Agi Req",
        "lvl": "Level", "majorIds": "Major ID"
    };

    const STAT_HEADER_CLASSES = {
        "wDam": "elem-water", "wDamPct": "elem-water", "wDamRaw": "elem-water", "wDef": "elem-water", "wDefPct": "elem-water", "wBase": "elem-water", "wSdPct": "elem-water", "wMdPct": "elem-water",
        "eDam": "elem-earth", "eDamPct": "elem-earth", "eDamRaw": "elem-earth", "eDef": "elem-earth", "eDefPct": "elem-earth", "eBase": "elem-earth", "eSdPct": "elem-earth", "eMdPct": "elem-earth",
        "tDam": "elem-thunder", "tDamPct": "elem-thunder", "tDamRaw": "elem-thunder", "tDef": "elem-thunder", "tDefPct": "elem-thunder", "tBase": "elem-thunder", "tSdPct": "elem-thunder", "tMdPct": "elem-thunder",
        "fDam": "elem-fire", "fDamPct": "elem-fire", "fDamRaw": "elem-fire", "fDef": "elem-fire", "fDefPct": "elem-fire", "fBase": "elem-fire", "fSdPct": "elem-fire", "fMdPct": "elem-fire",
        "aDam": "elem-air", "aDamPct": "elem-air", "aDamRaw": "elem-air", "aDef": "elem-air", "aDefPct": "elem-air", "aBase": "elem-air", "aSdPct": "elem-air", "aMdPct": "elem-air",
        "nDam": "elem-neutral", "nDamPct": "elem-neutral", "nDamRaw": "elem-neutral"
    };

    function parseDamageRangeMax(str) {
        if (!str || typeof str !== "string") return 0;
        const parts = str.split("-").map(Number);
        return isNaN(parts[1]) ? (isNaN(parts[0]) ? 0 : parts[0]) : parts[1];
    }

    function parseDamageRangeAvg(str) {
        if (!str || typeof str !== "string") return 0;
        const parts = str.split("-").map(Number);
        if (!isNaN(parts[0]) && !isNaN(parts[1])) return (parts[0] + parts[1]) / 2;
        return isNaN(parts[0]) ? 0 : parts[0];
    }

    function getItemStatValue(item, canonicalKey) {
        switch (canonicalKey) {
            case "wDam": {
                const base = parseDamageRangeMax(item.wDam);
                const pct = item.wDamPct || 0;
                const raw = item.wDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "eDam": {
                const base = parseDamageRangeMax(item.eDam);
                const pct = item.eDamPct || 0;
                const raw = item.eDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "tDam": {
                const base = parseDamageRangeMax(item.tDam);
                const pct = item.tDamPct || 0;
                const raw = item.tDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "fDam": {
                const base = parseDamageRangeMax(item.fDam);
                const pct = item.fDamPct || 0;
                const raw = item.fDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "aDam": {
                const base = parseDamageRangeMax(item.aDam);
                const pct = item.aDamPct || 0;
                const raw = item.aDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "nDam": {
                const base = parseDamageRangeMax(item.nDam);
                const pct = item.nDamPct || 0;
                const raw = item.nDamRaw || 0;
                if (base > 0) return base;
                if (pct !== 0) return pct;
                return raw;
            }
            case "wBase": return parseDamageRangeAvg(item.wDam);
            case "eBase": return parseDamageRangeAvg(item.eDam);
            case "tBase": return parseDamageRangeAvg(item.tDam);
            case "fBase": return parseDamageRangeAvg(item.fDam);
            case "aBase": return parseDamageRangeAvg(item.aDam);
            case "nBase": return parseDamageRangeAvg(item.nDam);
            case "majorIds": return item.majorIds || [];
            default:
                return item[canonicalKey] !== undefined ? item[canonicalKey] : 0;
        }
    }

    function formatStatDisplay(item, canonicalKey) {
        if (canonicalKey === "wDam") {
            let parts = [];
            if (item.wDam && item.wDam !== "0-0") parts.push(item.wDam);
            if (item.wDamPct) parts.push(`${item.wDamPct > 0 ? "+" : ""}${item.wDamPct}%`);
            if (item.wDamRaw) parts.push(`${item.wDamRaw > 0 ? "+" : ""}${item.wDamRaw}`);
            return parts.length > 0 ? `<span class="elem-water">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "eDam") {
            let parts = [];
            if (item.eDam && item.eDam !== "0-0") parts.push(item.eDam);
            if (item.eDamPct) parts.push(`${item.eDamPct > 0 ? "+" : ""}${item.eDamPct}%`);
            if (item.eDamRaw) parts.push(`${item.eDamRaw > 0 ? "+" : ""}${item.eDamRaw}`);
            return parts.length > 0 ? `<span class="elem-earth">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "tDam") {
            let parts = [];
            if (item.tDam && item.tDam !== "0-0") parts.push(item.tDam);
            if (item.tDamPct) parts.push(`${item.tDamPct > 0 ? "+" : ""}${item.tDamPct}%`);
            if (item.tDamRaw) parts.push(`${item.tDamRaw > 0 ? "+" : ""}${item.tDamRaw}`);
            return parts.length > 0 ? `<span class="elem-thunder">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "fDam") {
            let parts = [];
            if (item.fDam && item.fDam !== "0-0") parts.push(item.fDam);
            if (item.fDamPct) parts.push(`${item.fDamPct > 0 ? "+" : ""}${item.fDamPct}%`);
            if (item.fDamRaw) parts.push(`${item.fDamRaw > 0 ? "+" : ""}${item.fDamRaw}`);
            return parts.length > 0 ? `<span class="elem-fire">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "aDam") {
            let parts = [];
            if (item.aDam && item.aDam !== "0-0") parts.push(item.aDam);
            if (item.aDamPct) parts.push(`${item.aDamPct > 0 ? "+" : ""}${item.aDamPct}%`);
            if (item.aDamRaw) parts.push(`${item.aDamRaw > 0 ? "+" : ""}${item.aDamRaw}`);
            return parts.length > 0 ? `<span class="elem-air">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "nDam") {
            let parts = [];
            if (item.nDam && item.nDam !== "0-0") parts.push(item.nDam);
            if (item.nDamPct) parts.push(`${item.nDamPct > 0 ? "+" : ""}${item.nDamPct}%`);
            if (item.nDamRaw) parts.push(`${item.nDamRaw > 0 ? "+" : ""}${item.nDamRaw}`);
            return parts.length > 0 ? `<span class="elem-neutral">${parts.join(" ")}</span>` : "-";
        }
        if (canonicalKey === "majorIds") {
            return (item.majorIds && item.majorIds.length > 0) ? `<b class="tier-legendary">${escapeHtml(item.majorIds.join(", "))}</b>` : "-";
        }

        const val = item[canonicalKey];
        if (val === undefined || val === 0 || val === "0-0") return "-";

        const cssClass = STAT_HEADER_CLASSES[canonicalKey] || "";
        let valStr = "";
        if (canonicalKey.endsWith("Pct") || canonicalKey === "spd" || canonicalKey === "thorns" || canonicalKey === "ref" || canonicalKey === "expd" || canonicalKey === "xpb" || canonicalKey === "lb" || canonicalKey === "lq" || canonicalKey === "healPct") {
            valStr = `${val > 0 ? "+" : ""}${val}%`;
        } else if (canonicalKey === "mr") {
            valStr = `${val > 0 ? "+" : ""}${val}/5s`;
        } else if (canonicalKey === "ms" || canonicalKey === "ls" || canonicalKey === "poison") {
            valStr = `${val > 0 ? "+" : ""}${val}/3s`;
        } else if (typeof val === "number") {
            const noPlus = ["slots", "lvl", "strReq", "dexReq", "intReq", "defReq", "agiReq"];
            valStr = noPlus.includes(canonicalKey) ? String(val) : `${val > 0 ? "+" : ""}${val}`;
        } else {
            valStr = String(val);
        }

        return cssClass ? `<span class="${cssClass}">${valStr}</span>` : valStr;
    }

    function evaluateFilter(item, filter) {
        const { canonical, op, numVal, rawVal } = filter;

        if (canonical === "majorIds") {
            const majors = item.majorIds || [];
            const target = rawVal.toLowerCase();
            return majors.some(m => m.toLowerCase().includes(target));
        }

        if (canonical === "tier") {
            const t = (item.tier || "").toLowerCase();
            if (op === "!=" || op === "!==") return t !== rawVal.toLowerCase();
            return t === rawVal.toLowerCase();
        }

        if (canonical === "type") {
            const target = SEARCH_TYPE_ALIASES[rawVal.toLowerCase()] || rawVal.toLowerCase();
            return item.type === target || item.category === target;
        }

        if (canonical === "set") {
            const s = (item.set || "").toLowerCase();
            return s.includes(rawVal.toLowerCase());
        }

        if (canonical === "classReq") {
            const c = (item.classReq || "").toLowerCase();
            return c.includes(rawVal.toLowerCase());
        }

        const actual = getItemStatValue(item, canonical);

        if (op === ":") {
            const parts = rawVal.split("-").map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return actual >= parts[0] && actual <= parts[1];
            }
            return actual === numVal;
        }

        if (isNaN(numVal)) return false;

        switch (op) {
            case ">": return actual > numVal;
            case ">=": return actual >= numVal;
            case "<": return actual < numVal;
            case "<=": return actual <= numVal;
            case "=":
            case "==": return actual === numVal;
            case "!=":
            case "!==": return actual !== numVal;
            default: return actual > 0;
        }
    }

    function cmdSearch(args) {
        if (args.length === 0) {
            let help = "<div class='term-box'><b>Usage:</b> <code>search &lt;query&gt; [-t &lt;type&gt;] [-r &lt;rarity&gt;] [-lvl &lt;min-max&gt;] [stat filters] [-sort &lt;stat&gt;] [-n &lt;limit&gt;]</code><br/><br/>";
            help += "<b>Examples:</b><br/>";
            help += "&nbsp;&nbsp;<code>search -t wand wDam&gt;0</code> (all wands with positive water damage)<br/>";
            help += "&nbsp;&nbsp;<code>search -t wand water damage &gt; 0</code><br/>";
            help += "&nbsp;&nbsp;<code>search water damage</code> (all items with positive water damage)<br/>";
            help += "&nbsp;&nbsp;<code>search -t ring mr&gt;=3 spd&gt;10</code> (rings with ≥3 MR and &gt;10% speed)<br/>";
            help += "&nbsp;&nbsp;<code>search -t dagger -r mythic</code><br/>";
            help += "&nbsp;&nbsp;<code>search -t bow -lvl 90-106 -sort wDam -n 10</code><br/><br/>";
            help += "<b>Supported Stat Filters:</b><br/>";
            help += "&nbsp;&nbsp;• <b>Elements:</b> <code>wDam</code> (water), <code>eDam</code> (earth), <code>tDam</code> (thunder), <code>fDam</code> (fire), <code>aDam</code> (air), <code>nDam</code> (neutral)<br/>";
            help += "&nbsp;&nbsp;• <b>Sub-stats:</b> <code>wDamPct</code>, <code>wDamRaw</code>, <code>wBase</code>, <code>wSdPct</code>, <code>wMdPct</code>, <code>wDef</code>, <code>wDefPct</code><br/>";
            help += "&nbsp;&nbsp;• <b>General:</b> <code>mr</code> (mana regen), <code>ms</code> (mana steal), <code>spd</code> (speed), <code>sdPct</code> (spell dam %), <code>mdPct</code> (melee dam %)<br/>";
            help += "&nbsp;&nbsp;• <b>Sustain/Utility:</b> <code>hp</code>, <code>hpr</code> (health regen), <code>ls</code> (life steal), <code>poison</code>, <code>slots</code>, <code>strReq</code>, <code>dexReq</code>, etc.<br/>";
            help += "&nbsp;&nbsp;• <b>Operators:</b> <code>&gt;</code>, <code>&gt;=</code>, <code>&lt;</code>, <code>&lt;=</code>, <code>=</code>, <code>!=</code><br/>";
            help += "&nbsp;&nbsp;• <b>Shorthand:</b> <code>+wDam</code>, <code>+mr</code>, <code>+spd</code> (equivalent to <code>&gt;0</code>)</div>";
            printLine(help);
            return;
        }

        // Normalize adjacent operator tokens
        const rawTokens = args;
        const tokens = [];
        for (let i = 0; i < rawTokens.length; i++) {
            const t = rawTokens[i];
            if (['>', '>=', '<', '<=', '=', '!=', ':'].includes(t)) {
                const prev = tokens.pop() || '';
                const next = rawTokens[++i] || '';
                tokens.push(prev + t + next);
            } else if (['>', '>=', '<', '<=', '=', '!=', ':'].some(op => t.startsWith(op))) {
                const prev = tokens.pop() || '';
                tokens.push(prev + t);
            } else if (['>', '>=', '<', '<=', '=', '!=', ':'].some(op => t.endsWith(op))) {
                const next = rawTokens[++i] || '';
                tokens.push(t + next);
            } else {
                tokens.push(t);
            }
        }

        let typeFilter = null;
        let rarityFilter = null;
        let lvlMin = 0;
        let lvlMax = 121;
        let limit = 25;
        let sortBy = null;
        let sortDesc = true;
        let statFilters = [];
        let queryWords = [];

        for (let i = 0; i < tokens.length; i++) {
            const tok = tokens[i];
            const tokLower = tok.toLowerCase();

            if ((tokLower === "-t" || tokLower === "--type") && i + 1 < tokens.length) {
                typeFilter = tokens[++i].toLowerCase();
            } else if ((tokLower === "-r" || tokLower === "--rarity" || tokLower === "-tier") && i + 1 < tokens.length) {
                rarityFilter = tokens[++i].toLowerCase();
            } else if ((tokLower === "-lvl" || tokLower === "--level") && i + 1 < tokens.length) {
                const bounds = tokens[++i].split("-").map(Number);
                if (bounds.length === 2 && !isNaN(bounds[0]) && !isNaN(bounds[1])) {
                    lvlMin = bounds[0];
                    lvlMax = bounds[1];
                }
            } else if ((tokLower === "-n" || tokLower === "--limit") && i + 1 < tokens.length) {
                const n = parseInt(tokens[++i], 10);
                if (!isNaN(n) && n > 0) limit = Math.min(n, 100);
            } else if ((tokLower === "-sort" || tokLower === "--sort") && i + 1 < tokens.length) {
                let s = tokens[++i];
                if (s.startsWith("-")) {
                    sortDesc = true;
                    s = s.slice(1);
                } else if (s.startsWith("+")) {
                    sortDesc = false;
                    s = s.slice(1);
                }
                const sKey = s.toLowerCase().replace(/[^a-z0-9%]/g, "");
                sortBy = STAT_ALIASES[sKey] || sKey;
            } else if ((tokLower === "-f" || tokLower === "--filter") && i + 1 < tokens.length) {
                const fStr = tokens[++i];
                const opMatch = fStr.match(/^(.+?)(>=|<=|>|<|!=|=|:)(.+)$/);
                if (opMatch) {
                    const k = opMatch[1].trim().toLowerCase().replace(/[^a-z0-9%]/g, "");
                    const op = opMatch[2];
                    const v = opMatch[3].trim().replace(/^["']|["']$/g, "");
                    const canonical = STAT_ALIASES[k] || k;
                    statFilters.push({ rawKey: k, canonical, op, rawVal: v, numVal: Number(v) });
                } else {
                    const k = fStr.trim().toLowerCase().replace(/[^a-z0-9%]/g, "");
                    const canonical = STAT_ALIASES[k] || k;
                    statFilters.push({ rawKey: k, canonical, op: ">", rawVal: "0", numVal: 0 });
                }
            } else {
                const opMatch = tok.match(/^(.+?)(>=|<=|>|<|!=|=|:)(.+)$/);
                if (opMatch) {
                    let k = opMatch[1].trim().toLowerCase().replace(/[^a-z0-9%]/g, "");
                    const op = opMatch[2];
                    const v = opMatch[3].trim().replace(/^["']|["']$/g, "");

                    if (queryWords.length > 0) {
                        const prev = queryWords[queryWords.length - 1];
                        const combined = prev + k;
                        if (STAT_ALIASES[combined]) {
                            k = combined;
                            queryWords.pop();
                        }
                    }
                    const canonical = STAT_ALIASES[k] || k;
                    statFilters.push({ rawKey: k, canonical, op, rawVal: v, numVal: Number(v) });
                } else if (tok.startsWith("+")) {
                    const k = tok.slice(1).toLowerCase().replace(/[^a-z0-9%]/g, "");
                    const canonical = STAT_ALIASES[k] || k;
                    statFilters.push({ rawKey: k, canonical, op: ">", rawVal: "0", numVal: 0 });
                } else {
                    queryWords.push(tok.toLowerCase());
                }
            }
        }

        // If query words form a recognized stat alias and no stat filter was set, treat as stat > 0
        if (statFilters.length === 0 && queryWords.length > 0) {
            const potentialStat = queryWords.join("").replace(/[^a-z0-9%]/g, "");
            const isSingleGenericWord = ["water", "earth", "thunder", "fire", "air", "neutral"].includes(potentialStat);
            if (STAT_ALIASES[potentialStat] && !isSingleGenericWord) {
                const canonical = STAT_ALIASES[potentialStat];
                statFilters.push({ rawKey: potentialStat, canonical, op: ">", rawVal: "0", numVal: 0 });
                queryWords = [];
            }
        }

        const queryStr = queryWords.join(" ");
        let matches = [];

        for (const item of items) {
            if (!item.displayName || item.displayName.startsWith("No ")) continue;

            if (typeFilter) {
                const slot = SEARCH_TYPE_ALIASES[typeFilter] || typeFilter;
                if (item.type !== slot && item.category !== slot) continue;
            }

            if (rarityFilter) {
                if (!item.tier || item.tier.toLowerCase() !== rarityFilter) continue;
            }

            if (item.lvl < lvlMin || item.lvl > lvlMax) continue;

            if (queryStr && !item.displayName.toLowerCase().includes(queryStr)) continue;

            let pass = true;
            for (const f of statFilters) {
                if (!evaluateFilter(item, f)) {
                    pass = false;
                    break;
                }
            }
            if (!pass) continue;

            matches.push(item);
        }

        if (matches.length === 0) {
            printLine("No items matching search criteria.", "term-line-warn");
            return;
        }

        // Sorting
        if (sortBy) {
            matches.sort((a, b) => {
                const vA = getItemStatValue(a, sortBy);
                const vB = getItemStatValue(b, sortBy);
                return sortDesc ? (vB - vA) : (vA - vB);
            });
        } else if (statFilters.length > 0) {
            const primary = statFilters[0].canonical;
            matches.sort((a, b) => {
                const vA = getItemStatValue(a, primary);
                const vB = getItemStatValue(b, primary);
                if (vB !== vA) return vB - vA;
                return (b.lvl || 0) - (a.lvl || 0);
            });
        } else {
            matches.sort((a, b) => (b.lvl || 0) - (a.lvl || 0));
        }

        const displayItems = matches.slice(0, limit);

        // Determine extra columns to display (up to 3 stat columns)
        const displayStats = [];
        for (const f of statFilters) {
            if (!displayStats.includes(f.canonical) && displayStats.length < 3) {
                displayStats.push(f.canonical);
            }
        }
        if (sortBy && !displayStats.includes(sortBy) && displayStats.length < 3 && sortBy !== "lvl") {
            displayStats.push(sortBy);
        }

        let out = `<div class='term-box'><b>Search Results (${matches.length} match${matches.length === 1 ? "" : "es"} found${matches.length > displayItems.length ? `, showing top ${displayItems.length}` : ""}):</b>`;

        let filterTags = [];
        if (typeFilter) filterTags.push(`type: <b>${escapeHtml(typeFilter)}</b>`);
        if (rarityFilter) filterTags.push(`rarity: <b>${escapeHtml(rarityFilter)}</b>`);
        if (lvlMin > 0 || lvlMax < 121) filterTags.push(`lvl: <b>${lvlMin}-${lvlMax}</b>`);
        if (queryStr) filterTags.push(`name: <b>"${escapeHtml(queryStr)}"</b>`);
        for (const f of statFilters) {
            const name = STAT_DISPLAY_NAMES[f.canonical] || f.canonical;
            const cls = STAT_HEADER_CLASSES[f.canonical] || "";
            const span = cls ? `<span class='${cls}'>${name}</span>` : name;
            filterTags.push(`${span} ${f.op} ${f.rawVal}`);
        }
        if (sortBy) {
            const sName = STAT_DISPLAY_NAMES[sortBy] || sortBy;
            filterTags.push(`sorted by: <b>${sName} (${sortDesc ? "desc" : "asc"})</b>`);
        }
        if (filterTags.length > 0) {
            out += `<div style='margin: 4px 0 6px 0; color: var(--term-muted); font-size: 12px;'>[Filters: ${filterTags.join(", ")}]</div>`;
        }

        out += "<table class='term-table'>";
        out += "<tr><th>Name</th><th>Tier</th><th>Type</th><th>Level</th>";
        for (const statKey of displayStats) {
            const cls = STAT_HEADER_CLASSES[statKey] || "";
            const title = STAT_DISPLAY_NAMES[statKey] || statKey;
            out += `<th>${cls ? `<span class='${cls}'>${title}</span>` : title}</th>`;
        }
        out += "</tr>";

        for (const it of displayItems) {
            const tierClass = getTierClass(it.tier);
            out += `<tr><td><span class='${tierClass}'>${escapeHtml(it.displayName)}</span></td><td>${it.tier}</td><td>${it.type}</td><td>${it.lvl}</td>`;
            for (const statKey of displayStats) {
                out += `<td>${formatStatDisplay(it, statKey)}</td>`;
            }
            out += "</tr>";
        }
        out += "</table><i>Use <code>equip &lt;slot&gt; &lt;name&gt;</code> to equip any of these items.</i></div>";
        printLine(out);
    }

    function cmdBoost(args) {
        const boosts = ["warscream", "totem", "fortitude", "emboldeningcry", "judgement"];

        if (args.length === 0) {
            let out = "<div class='term-box'><b>Active Combat Multipliers:</b><table class='term-table'>";
            out += "<tr><th>Boost</th><th>Status</th></tr>";
            for (const b of boosts) {
                const elem = document.getElementById(b + "-boost");
                const on = elem && elem.classList.contains("toggleOn");
                const status = on ? "<span class='term-line-success'>ON</span>" : "<span class='term-line-system'>OFF</span>";
                out += `<tr><td>${b}</td><td>${status}</td></tr>`;
            }
            out += "</table><i>Use <code>boost &lt;name&gt;</code> to toggle a boost.</i></div>";
            printLine(out);
            return;
        }

        const target = args[0].toLowerCase();
        if (target === "clear") {
            for (const b of boosts) {
                const elem = document.getElementById(b + "-boost");
                if (elem && elem.classList.contains("toggleOn")) {
                    elem.classList.remove("toggleOn");
                }
            }
            boosts_node.mark_dirty().update();
            printLine("Cleared all active boosts.", "term-line-success");
            return;
        }

        if (boosts.includes(target)) {
            const elem = document.getElementById(target + "-boost");
            if (elem) {
                if (elem.classList.contains("toggleOn")) {
                    elem.classList.remove("toggleOn");
                    printLine(`Toggled boost <b>${target}</b> <span class='term-line-system'>OFF</span>.`, "term-line-info");
                } else {
                    elem.classList.add("toggleOn");
                    printLine(`Toggled boost <b>${target}</b> <span class='term-line-success'>ON</span>.`, "term-line-success");
                }
                boosts_node.mark_dirty().update();
            }
            return;
        }

        printLine(`Unknown boost '${escapeHtml(target)}'. Valid: ${boosts.join(", ")} or 'clear'`, "term-line-error");
    }

    function cmdOptimize() {
        if (!player_build) {
            printLine("No active build found to optimize.", "term-line-warn");
            return;
        }
        if (typeof optimizeStrDex === "function") {
            optimizeStrDex();
            printLine("Ran Str/Dex damage optimizer on remaining skill points.", "term-line-success");
            cmdSkillPoints([]);
        } else {
            printLine("Optimizer function not available.", "term-line-error");
        }
    }

    function cmdLink() {
        const url = window.location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(() => {
                printLine(`Build URL copied to clipboard!<br/><a href='${url}' target='_blank' style='color: var(--term-prompt);'>${url}</a>`, "term-line-success");
            }).catch(() => {
                printLine(`Build URL: <a href='${url}' target='_blank' style='color: var(--term-prompt);'>${url}</a>`, "term-line-info");
            });
        } else {
            printLine(`Build URL: <a href='${url}' target='_blank' style='color: var(--term-prompt);'>${url}</a>`, "term-line-info");
        }
    }

    async function cmdImport(args) {
        if (args.length === 0) {
            printLine("Usage: import &lt;wynnbuilder_url_or_hash&gt;", "term-line-warn");
            printLine("Example: import #8_09909x09s09v02A02A09r09r00...", "term-line-system");
            return;
        }

        let hash = args[0].trim();
        if (hash.includes("#")) {
            hash = hash.substring(hash.indexOf("#"));
        } else if (!hash.startsWith("#")) {
            hash = "#" + hash;
        }

        printLine(`Importing build from hash ${hash.substring(0, 15)}...`, "term-line-system");
        window.location.hash = hash;

        // Run decodeHash
        try {
            const skillpoints = await decodeHash();
            if (typeof builder_graph_init === "function") {
                builder_graph_init(skillpoints);
            }
            printLine("Build successfully imported!", "term-line-success");
            cmdBuild();
        } catch (e) {
            printLine(`Failed to decode build hash: ${e.message || String(e)}`, "term-line-error");
        }
    }

    function cmdReset() {
        if (typeof resetFields === "function") {
            resetFields();
            printLine("Build has been reset to blank.", "term-line-success");
        } else {
            cmdUnequip(["all"]);
            cmdSkillPoints(["reset"]);
        }
    }

    function cmdClear() {
        if (outputElem) {
            outputElem.innerHTML = "";
            printBanner();
        }
    }

    function cmdHistory() {
        if (history.length === 0) {
            printLine("Command history is empty.", "term-line-system");
            return;
        }
        let out = "<div class='term-box'><b>Command History:</b><br/>";
        for (let i = 0; i < history.length; i++) {
            out += `${i + 1}: <code>${escapeHtml(history[i])}</code><br/>`;
        }
        out += "</div>";
        printLine(out);
    }

    function cmdGui() {
        const isGui = document.body.classList.contains("gui-active");
        if (isGui) {
            document.body.classList.remove("gui-active");
            document.body.classList.add("terminal-active");
            printLine("Switched to Terminal view.", "term-line-info");
        } else {
            document.body.classList.remove("terminal-active");
            document.body.classList.add("gui-active");
        }
    }

    // =========================================================================
    // HELPER FUNCTIONS
    // =========================================================================

    function isSlotCompatible(item, slot) {
        if (!slot) return true;
        slot = SLOT_ALIASES[slot] || slot;
        if (slot === "weapon") {
            return ["bow", "spear", "wand", "dagger", "relik"].includes(item.type) || item.category === "weapon";
        }
        const cleanSlot = slot.replace(/[0-9]/g, '');
        return item.type === cleanSlot || item.category === cleanSlot || (item.type === "ring" && slot.startsWith("ring"));
    }

    function resolveItemExactOrCase(query, preferredSlot = null) {
        if (!itemMap || !query) return null;
        query = query.trim();

        // 1. Exact match
        if (itemMap.has(query)) {
            const it = itemMap.get(query);
            if (isSlotCompatible(it, preferredSlot)) return it;
        }

        // 2. Case-insensitive match in itemMap
        const qLower = query.toLowerCase();
        for (const [name, item] of itemMap.entries()) {
            if (name.toLowerCase() === qLower) {
                if (isSlotCompatible(item, preferredSlot)) return item;
            }
        }

        return null;
    }

    function resolveItem(query, preferredSlot = null) {
        if (!itemMap || !query) return null;
        query = query.trim();

        const exact = resolveItemExactOrCase(query, preferredSlot);
        if (exact) return exact;

        const qLower = query.toLowerCase();

        // 3. Slot-restricted prefix/substring match
        if (preferredSlot && itemLists) {
            const slotKey = preferredSlot === "weapon" ? "dagger" : preferredSlot.replace(/[0-9]/g, '');
            let slotItems = [];
            if (preferredSlot === "weapon") {
                for (const wk of ["bow", "spear", "wand", "dagger", "relik"]) {
                    if (itemLists.has(wk)) slotItems.push(...itemLists.get(wk));
                }
            } else if (itemLists.has(slotKey)) {
                slotItems = itemLists.get(slotKey);
            }

            // Prefix match in slot
            for (const name of slotItems) {
                if (name.toLowerCase().startsWith(qLower)) {
                    const it = itemMap.get(name);
                    if (isSlotCompatible(it, preferredSlot)) return it;
                }
            }
            // Substring match in slot
            for (const name of slotItems) {
                if (name.toLowerCase().includes(qLower)) {
                    const it = itemMap.get(name);
                    if (isSlotCompatible(it, preferredSlot)) return it;
                }
            }
        }

        // 4. Global prefix match
        for (const [name, item] of itemMap.entries()) {
            if (name.toLowerCase().startsWith(qLower)) {
                if (isSlotCompatible(item, preferredSlot)) return item;
            }
        }

        // 5. Global substring match
        for (const [name, item] of itemMap.entries()) {
            if (name.toLowerCase().includes(qLower)) {
                if (isSlotCompatible(item, preferredSlot)) return item;
            }
        }

        // 6. Normalized match (ignoring hyphens, apostrophes, spaces, periods)
        const qNorm = qLower.replace(/[-_\s'\.]/g, '');
        if (qNorm.length >= 3) {
            for (const [name, item] of itemMap.entries()) {
                const nNorm = name.toLowerCase().replace(/[-_\s'\.]/g, '');
                if (nNorm === qNorm) {
                    if (isSlotCompatible(item, preferredSlot)) return item;
                }
            }
            for (const [name, item] of itemMap.entries()) {
                const nNorm = name.toLowerCase().replace(/[-_\s'\.]/g, '');
                if (nNorm.startsWith(qNorm) || nNorm.includes(qNorm)) {
                    if (isSlotCompatible(item, preferredSlot)) return item;
                }
            }
        }

        return null;
    }

    function getTierClass(tier) {
        if (!tier) return "tier-normal";
        const t = tier.toLowerCase();
        if (t.includes("mythic")) return "tier-mythic";
        if (t.includes("fabled")) return "tier-fabled";
        if (t.includes("legendary")) return "tier-legendary";
        if (t.includes("rare")) return "tier-rare";
        if (t.includes("unique")) return "tier-unique";
        if (t.includes("set")) return "tier-set";
        if (t.includes("crafted")) return "tier-crafted";
        if (t.includes("custom")) return "tier-custom";
        return "tier-normal";
    }

    function getElemName(idx) {
        const elems = ["earth", "thunder", "water", "fire", "air"];
        return elems[idx] || "neutral";
    }

    function getBuildWarnings() {
        const warnings = [];
        const bwElem = document.getElementById("build-warnings");
        if (bwElem && bwElem.textContent.trim()) {
            warnings.push(bwElem.textContent.trim());
        }
        for (const skp of ["str", "dex", "int", "def", "agi"]) {
            const el = document.getElementById(skp + "-warnings");
            if (el && el.textContent.trim()) {
                warnings.push(`${skp.toUpperCase()}: ${el.textContent.trim()}`);
            }
        }
        return warnings;
    }

    function escapeHtml(str) {
        if (!str) return "";
        return String(str)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // =========================================================================
    // ABILITY TREE COMMANDS & HELPERS
    // =========================================================================

    function cleanDesc(desc) {
        if (!desc) return "";
        return String(desc)
            .replace(/<\/br>|<br\s*\/?>/gi, "\n")
            .replace(/&emsp;/gi, "  ")
            .replace(/§[0-9a-fk-or]/gi, "")
            .replace(/<[^>]+>/g, "")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&amp;/g, "&")
            .trim();
    }

    function truncateDesc(desc, maxLen = 85) {
        const c = cleanDesc(desc).replace(/\s+/g, " ");
        if (c.length <= maxLen) return c;
        return c.slice(0, maxLen) + "...";
    }

    function getAtreeAnalysis() {
        if (typeof atree_node === "undefined" || !atree_node || !atree_node.value || atree_node.value.length === 0 ||
            typeof atree_state_node === "undefined" || !atree_state_node || !atree_state_node.value) {
            return null;
        }

        const atree_order = atree_node.value;
        const atree_state = atree_state_node.value;

        // Determine Level and AP Cap
        let level = 106;
        if (typeof player_build !== "undefined" && player_build && player_build.level) {
            level = parseInt(player_build.level) || 106;
        } else if (typeof level_input !== "undefined" && level_input.value) {
            const parsed = parseInt(level_input.value);
            if (!isNaN(parsed)) level = parsed;
        }

        const atree_level_table = ['lvl0wtf',1,2,2,3,3,4,4,5,5,6,6,7,8,8,9,9,10,11,11,12,12,13,14,14,15,16,16,17,17,18,18,19,19,20,20,20,21,21,22,22,23,23,23,24,24,25,25,26,26,27,27,28,28,29,29,30,30,31,31,32,32,33,33,34,34,34,35,35,35,36,36,36,37,37,37,38,38,38,38,39,39,39,39,40,40,40,40,41,41,41,41,42,42,42,42,43,43,43,43,44,44,44,44,45,45,45,46,46,46,47,47,47,48,48,48,49,49,49,49,50,50];
        let apCap = atree_level_table[level] || 50;
        const apCapElem = document.getElementById("active_AP_cap");
        if (apCapElem && apCapElem.textContent && !isNaN(parseInt(apCapElem.textContent))) {
            apCap = parseInt(apCapElem.textContent);
        }

        let atree_to_add = [];
        let inactive_nodes = [];
        for (const node of atree_order) {
            const abil = node.ability;
            const state = atree_state.get(abil.id);
            if (state && state.active) {
                atree_to_add.push([node, 'not reachable', false]);
            } else {
                inactive_nodes.push(node);
            }
        }

        // Iteratively resolve reachable nodes and compute total AP and archetype counts
        let reachable = new Set();
        let apUsed = 0;
        let archetypeCount = new Map();

        while (true) {
            let _add = [];
            for (const [node, fail_reason, fail_hardness] of atree_to_add) {
                const { ability } = node;
                const [success, hard_error, reason] = abil_can_activate(node, atree_state, reachable, archetypeCount, 9999);
                if (!success) {
                    _add.push([node, reason, hard_error]);
                    continue;
                }
                if (ability.archetype && ability.archetype !== "") {
                    const current = archetypeCount.get(ability.archetype) || 0;
                    archetypeCount.set(ability.archetype, current + 1);
                }
                apUsed += ability.cost;
                reachable.add(ability.id);
            }
            if (atree_to_add.length === _add.length) {
                atree_to_add = _add;
                break;
            }
            atree_to_add = _add;
        }

        const apLeft = apCap - apUsed;

        // Evaluate takability of inactive nodes
        const takableNodes = [];
        const untakableNodes = [];

        for (const node of inactive_nodes) {
            const [success, hard_error, reason] = abil_can_activate(node, atree_state, reachable, archetypeCount, apLeft);
            
            const activeParents = [];
            for (const parent of node.parents) {
                if (reachable.has(parent.ability.id)) {
                    activeParents.push(parent.ability.display_name || parent.ability.name);
                }
            }

            if (success) {
                takableNodes.push({
                    node,
                    ability: node.ability,
                    stateNode: atree_state.get(node.ability.id),
                    activeParents
                });
            } else {
                untakableNodes.push({
                    node,
                    ability: node.ability,
                    stateNode: atree_state.get(node.ability.id),
                    reason,
                    activeParents
                });
            }
        }

        const disconnectedActive = atree_to_add.map(([node, reason, hard]) => ({
            node,
            ability: node.ability,
            reason,
            hard
        }));

        return {
            atree_order,
            atree_state,
            reachable,
            apUsed,
            apCap,
            apLeft,
            archetypeCount,
            activeCount: atree_order.length - inactive_nodes.length,
            totalCount: atree_order.length,
            takableNodes,
            untakableNodes,
            disconnectedActive
        };
    }

    function resolveAtreeNode(query) {
        if (typeof atree_node === "undefined" || !atree_node.value || typeof atree_state_node === "undefined" || !atree_state_node.value) {
            return { match: null, candidates: [], error: "No ability tree is currently loaded. Equip a weapon first." };
        }
        if (!query || !query.trim()) {
            return { match: null, candidates: [], error: "Please specify an ability name or ID." };
        }

        const q = query.trim().replace(/^["']|["']$/g, '');
        const atree_state = atree_state_node.value;

        // 1. Direct ID match
        if (/^\d+$/.test(q)) {
            const id = parseInt(q, 10);
            if (atree_state.has(id)) {
                const node = atree_state.get(id);
                return { match: node, candidates: [node] };
            }
        }

        const qLower = q.toLowerCase();
        const allNodes = Array.from(atree_state.values());

        // 2. Exact match
        const exact = allNodes.find(n => {
            const dn = (n.ability.display_name || "").toLowerCase();
            const nm = (n.ability.name || "").toLowerCase();
            return dn === qLower || nm === qLower;
        });
        if (exact) {
            return { match: exact, candidates: [exact] };
        }

        // 3. Prefix match
        const prefixMatches = allNodes.filter(n => {
            const dn = (n.ability.display_name || "").toLowerCase();
            return dn.startsWith(qLower);
        });
        if (prefixMatches.length === 1) {
            return { match: prefixMatches[0], candidates: prefixMatches };
        }
        if (prefixMatches.length > 1) {
            return { match: null, candidates: prefixMatches };
        }

        // 4. Substring match
        const subMatches = allNodes.filter(n => {
            const dn = (n.ability.display_name || "").toLowerCase();
            return dn.includes(qLower);
        });
        if (subMatches.length === 1) {
            return { match: subMatches[0], candidates: subMatches };
        }
        if (subMatches.length > 1) {
            return { match: null, candidates: subMatches };
        }

        return { match: null, candidates: [], error: `No ability matching '${escapeHtml(q)}' found in this tree.` };
    }

    function cmdAtree(args) {
        const analysis = getAtreeAnalysis();
        if (!analysis) {
            printLine("<div class='term-box'><span class='term-line-warn'>No weapon equipped.</span> Please equip a weapon first to access its ability tree (e.g. <code>equip weapon Cataclysm</code> or <code>equip weapon Warp</code>).</div>");
            return;
        }

        if (args.length === 0) {
            showAtreeSummary(analysis);
            return;
        }

        const sub = args[0].toLowerCase();
        const rest = args.slice(1);

        switch (sub) {
            case "summary":
            case "status":
                showAtreeSummary(analysis);
                break;
            case "list":
            case "all":
            case "ls":
                showAtreeList(analysis, rest);
                break;
            case "takable":
            case "available":
            case "takeable":
            case "avail":
            case "next":
                showAtreeTakable(analysis);
                break;
            case "toggle":
            case "t":
                doAtreeToggle(rest, "toggle");
                showAtreeSummary(analysis)
                break;
            case "take":
            case "add":
            case "select":
                doAtreeToggle(rest, "take");
                showAtreeSummary(analysis)
                break;
            case "remove":
            case "rm":
            case "unequip":
            case "unselect":
            case "untake":
                doAtreeToggle(rest, "remove");
                showAtreeSummary(analysis)
                break;
            case "info":
            case "view":
            case "inspect":
            case "show":
                showAtreeInfo(rest);
                break;
            case "reset":
            case "clear":
                doAtreeReset();
                break;
            case "help":
                showAtreeHelp();
                break;
            default:
                // Check if user directly passed a node name or ID e.g. 'atree Spin Attack' or 'atree 12'
                const directRes = resolveAtreeNode(args.join(" "));
                if (directRes.match) {
                    doAtreeToggle(args, "toggle");
                } else if (directRes.candidates && directRes.candidates.length > 1) {
                    printLine(`Multiple abilities match '<b>${escapeHtml(args.join(" "))}</b>':`, "term-line-warn");
                    for (const c of directRes.candidates.slice(0, 10)) {
                        printLine(`&nbsp;&nbsp;• [<b>#${c.ability.id}</b>] ${escapeHtml(c.ability.display_name || c.ability.name)}`);
                    }
                    printLine("Please specify by full name or ID (e.g. <code>atree toggle " + directRes.candidates[0].ability.id + "</code>).", "term-line-system");
                } else {
                    printLine(`Unknown atree subcommand or ability: '<b>${escapeHtml(sub)}</b>'. Type <span class='term-line-info'>atree help</span> for usage.`, "term-line-error");
                }
                break;
        }
    }

    function showAtreeSummary(analysis) {
        const wep = player_build ? player_build.weapon : null;
        const wepType = wep ? wep.statMap.get("type") : "None";
        const playerClass = wep_to_class.has(wepType) ? wep_to_class.get(wepType) : "Unknown";

        let out = "<div class='term-box'>";
        out += `<b>=== Ability Tree Summary [${playerClass.toUpperCase()}] ===</b><br/>`;
        
        const apRemClass = analysis.apLeft < 0 ? "term-line-error" : "term-line-success";
        out += `Ability Points: <b>${analysis.apUsed}</b> / ${analysis.apCap} (<b class='${apRemClass}'>${analysis.apLeft}</b> remaining)<br/>`;
        out += `Active Abilities: <b>${analysis.activeCount}</b> / ${analysis.totalCount} | Takable: <b class='term-line-info'>${analysis.takableNodes.length}</b> available<br/>`;

        // Archetypes
        let archParts = [];
        for (const [arch, count] of analysis.archetypeCount) {
            archParts.push(`<span class='atree-arch-badge'>${escapeHtml(arch)} (${count})</span>`);
        }
        out += `Active Archetypes: ${archParts.length > 0 ? archParts.join(" ") : "<span class='term-line-system'>None</span>"}<br/>`;

        // Warnings / Disconnected
        if (analysis.disconnectedActive.length > 0) {
            out += `<div style='margin-top: 6px; color: var(--term-warning);'><b>⚠ Unreachable / Invalid Active Abilities (${analysis.disconnectedActive.length}):</b><br/>`;
            for (const d of analysis.disconnectedActive) {
                out += `&nbsp;&nbsp;• [#${d.ability.id}] ${escapeHtml(d.ability.display_name)} (<i>${escapeHtml(d.reason)}</i>)<br/>`;
            }
            out += "</div>";
        }
        if (analysis.apUsed > analysis.apCap) {
            out += `<div class='term-line-error' style='margin-top: 4px;'><b>⚠ Too many AP assigned! (${analysis.apUsed} > ${analysis.apCap})</b></div>`;
        }

        // Quick peek at takable
        if (analysis.takableNodes.length > 0) {
            out += `<div style='margin-top: 8px;'><b>Next Takable Abilities (${analysis.takableNodes.length}):</b><br/>`;
            for (const t of analysis.takableNodes.slice(0, 5)) {
                const arch = t.ability.archetype ? ` <span class='atree-arch-badge'>${escapeHtml(t.ability.archetype)}</span>` : "";
                const parents = t.activeParents.length > 0 ? ` <span class='term-line-system'>via ${escapeHtml(t.activeParents.join(", "))}</span>` : " <span class='term-line-success'>(Root)</span>";
                out += `&nbsp;&nbsp;• [#${t.ability.id}] <b>${escapeHtml(t.ability.display_name)}</b> (${t.ability.cost} AP)${arch}${parents}<br/>`;
            }
            if (analysis.takableNodes.length > 5) {
                out += `&nbsp;&nbsp;... and ${analysis.takableNodes.length - 5} more. (Type <span class='term-line-info'>atree takable</span> to view all)<br/>`;
            }
            out += "</div>";
        } else if (analysis.apLeft <= 0) {
            out += `<div style='margin-top: 6px;' class='term-line-warn'>No more abilities can be taken (AP cap reached: ${analysis.apCap} AP).</div>`;
        }

        out += `<div style='margin-top: 8px;' class='term-line-system'>Commands: <code>atree takable</code> (available) | <code>atree list</code> (all) | <code>atree toggle &lt;name|id&gt;</code> | <code>atree info &lt;name|id&gt;</code> | <code>atree reset</code></div>`;
        out += "</div>";
        printLine(out);
    }

    function showAtreeTakable(analysis) {
        if (!analysis.takableNodes || analysis.takableNodes.length === 0) {
            let msg = "<div class='term-box'>";
            if (analysis.apLeft <= 0) {
                msg += `<b>No abilities are currently takable:</b> you have reached your AP cap (<b>${analysis.apCap} AP</b>).<br/>Use <code>atree toggle &lt;name|id&gt;</code> to deactivate abilities and free up AP.`;
            } else if (analysis.activeCount === 0) {
                msg += `<b>No abilities currently active.</b> Type <code>atree list</code> to find your root ability (e.g. #0) and take it with <code>atree toggle 0</code>.`;
            } else {
                msg += `<b>No abilities are currently takable</b> based on your active path and requirements.`;
            }
            msg += "</div>";
            printLine(msg);
            return;
        }

        let out = "<div class='term-box'>";
        out += `<b>=== Takable Abilities (${analysis.takableNodes.length} Available | ${analysis.apLeft} AP Remaining) ===</b><br/>`;
        out += `<span class='term-line-system'>Type <code>atree toggle &lt;name|id&gt;</code> or <code>atree take &lt;name|id&gt;</code> to activate any of the following:</span><br/><br/>`;

        for (const t of analysis.takableNodes) {
            const abil = t.ability;
            const arch = abil.archetype ? ` <span class='atree-arch-badge'>${escapeHtml(abil.archetype)}</span>` : "";
            const cost = `<span class='atree-cost-badge'>${abil.cost} AP</span>`;
            
            let connStr = "";
            if (abil.parents.length === 0) {
                connStr = "<span class='term-line-success'>Starting Root Ability</span>";
            } else if (t.activeParents.length > 0) {
                connStr = `Connected via: <span class='term-line-info'>${escapeHtml(t.activeParents.join(", "))}</span>`;
            }
            if (abil.archetype_req && abil.archetype_req > 0) {
                const reqArch = abil.req_archetype || abil.archetype;
                connStr += ` | Req: ${escapeHtml(reqArch)} (${abil.archetype_req})`;
            }

            const descText = truncateDesc(abil.desc, 110);

            out += `<div style='margin-bottom: 8px;'>`;
            out += `&nbsp;<span class='atree-status-takable'>[+ CAN TAKE]</span> [<b>#${abil.id}</b>] <b>${escapeHtml(abil.display_name || abil.name)}</b> - ${cost}${arch}<br/>`;
            if (connStr) {
                out += `&nbsp;&nbsp;&nbsp;&nbsp;↳ <small class='term-line-system'>${connStr}</small><br/>`;
            }
            if (descText) {
                out += `&nbsp;&nbsp;&nbsp;&nbsp;<span style='color: #c9d1d9;'>${escapeHtml(descText)}</span><br/>`;
            }
            out += `</div>`;
        }

        out += `</div>`;
        printLine(out);
    }

    function showAtreeList(analysis, filterArgs) {
        let filter = filterArgs.join(" ").toLowerCase().trim();
        let nodes = analysis.atree_order;

        if (filter) {
            if (filter === "active" || filter === "taken" || filter === "on") {
                nodes = nodes.filter(n => analysis.atree_state.get(n.ability.id)?.active);
            } else if (filter === "takable" || filter === "avail" || filter === "available") {
                const takableIds = new Set(analysis.takableNodes.map(t => t.ability.id));
                nodes = nodes.filter(n => takableIds.has(n.ability.id));
            } else if (filter === "locked" || filter === "untakable") {
                const takableIds = new Set(analysis.takableNodes.map(t => t.ability.id));
                nodes = nodes.filter(n => !analysis.atree_state.get(n.ability.id)?.active && !takableIds.has(n.ability.id));
            } else {
                nodes = nodes.filter(n => {
                    const dn = (n.ability.display_name || "").toLowerCase();
                    const nm = (n.ability.name || "").toLowerCase();
                    const arch = (n.ability.archetype || "").toLowerCase();
                    return dn.includes(filter) || nm.includes(filter) || arch.includes(filter);
                });
            }
        }

        const takableSet = new Set(analysis.takableNodes.map(t => t.ability.id));
        const wep = player_build ? player_build.weapon : null;
        const wepType = wep ? wep.statMap.get("type") : "None";
        const playerClass = wep_to_class.has(wepType) ? wep_to_class.get(wepType) : "Unknown";

        let out = "<div class='term-box'>";
        out += `<b>=== Class Ability Tree: ${playerClass.toUpperCase()} (${nodes.length}/${analysis.totalCount} shown) ===</b><br/>`;
        if (filter) {
            out += `<small class='term-line-system'>Filtered by: '${escapeHtml(filter)}'</small><br/>`;
        }
        out += "<table class='term-table'>";
        out += "<tr><th style='width: 90px;'>Status</th><th style='width: 50px;'>ID</th><th>Ability Name</th><th>Cost</th><th>Archetype</th><th>Note</th></tr>";

        for (const n of nodes) {
            const abil = n.ability;
            const state = analysis.atree_state.get(abil.id);
            const isActive = state ? state.active : false;
            const isTakable = takableSet.has(abil.id);

            let statusTag = "<span class='atree-status-locked'>[ LOCKED]</span>";
            if (isActive) {
                statusTag = "<span class='atree-status-active'>[✓ ACTIVE]</span>";
            } else if (isTakable) {
                statusTag = "<span class='atree-status-takable'>[+ TAKABLE]</span>";
            }

            const arch = abil.archetype ? `<span class='atree-arch-badge'>${escapeHtml(abil.archetype)}</span>` : "-";
            const cost = `<span class='atree-cost-badge'>${abil.cost} AP</span>`;
            
            let note = "-";
            if (abil.parents.length === 0) {
                note = "<small class='term-line-success'>Root</small>";
            } else if (isTakable) {
                const parentNames = n.parents
                    .filter(p => analysis.reachable.has(p.ability.id))
                    .map(p => p.ability.display_name || p.ability.name);
                if (parentNames.length > 0) {
                    note = `<small class='term-line-info'>via ${escapeHtml(parentNames[0])}</small>`;
                }
            }

            out += `<tr><td>${statusTag}</td><td><b>#${abil.id}</b></td><td><b>${escapeHtml(abil.display_name || abil.name)}</b></td><td>${cost}</td><td>${arch}</td><td>${note}</td></tr>`;
        }

        out += "</table>";
        out += `<div class='term-line-system' style='margin-top: 6px;'>Tip: Use <code>atree toggle &lt;id|name&gt;</code> to activate/deactivate, or <code>atree info &lt;id|name&gt;</code> for details.</div>`;
        out += "</div>";
        printLine(out);
    }

    function doAtreeToggle(args, mode = "toggle") {
        if (args.length === 0) {
            printLine("Please specify an ability name or ID to toggle (e.g. <code>atree toggle 12</code> or <code>atree toggle Spin Attack</code>).", "term-line-warn");
            return;
        }

        const query = args.join(" ");
        const res = resolveAtreeNode(query);

        if (res.error) {
            printLine(res.error, "term-line-error");
            return;
        }

        if (res.candidates && res.candidates.length > 1) {
            printLine(`Multiple abilities match '<b>${escapeHtml(query)}</b>':`, "term-line-warn");
            for (const c of res.candidates.slice(0, 10)) {
                printLine(`&nbsp;&nbsp;• [<b>#${c.ability.id}</b>] ${escapeHtml(c.ability.display_name || c.ability.name)}`);
            }
            printLine("Please specify by full name or ID (e.g. <code>atree toggle " + res.candidates[0].ability.id + "</code>).", "term-line-system");
            return;
        }

        const nodeWrapper = res.match;
        const abil = nodeWrapper.ability;
        const currentActive = nodeWrapper.active;

        let targetActive = !currentActive;
        if (mode === "take") targetActive = true;
        if (mode === "remove") targetActive = false;

        if (currentActive === targetActive) {
            const statusStr = currentActive ? "already active" : "already inactive";
            printLine(`Ability [<b>#${abil.id}</b>] <b>${escapeHtml(abil.display_name || abil.name)}</b> is ${statusStr}.`, "term-line-warn");
            return;
        }

        // Apply state change
        atree_set_state(nodeWrapper, targetActive);
        atree_state_node.mark_dirty().update();

        // Check new analysis
        const newAnalysis = getAtreeAnalysis();
        const apRemClass = newAnalysis && newAnalysis.apLeft < 0 ? "term-line-error" : "term-line-success";
        const apInfo = newAnalysis ? `AP: <b>${newAnalysis.apUsed}</b>/${newAnalysis.apCap} (<b class='${apRemClass}'>${newAnalysis.apLeft}</b> remaining)` : "";

        if (targetActive) {
            printLine(`<span class='term-line-success'>✓ Activated ability:</span> [<b>#${abil.id}</b>] <b>${escapeHtml(abil.display_name || abil.name)}</b> (${abil.cost} AP). ${apInfo}`);
        } else {
            printLine(`<span class='term-line-info'>✗ Deactivated ability:</span> [<b>#${abil.id}</b>] <b>${escapeHtml(abil.display_name || abil.name)}</b>. ${apInfo}`);
        }

        // Report validation errors if any
        if (newAnalysis) {
            if (newAnalysis.disconnectedActive.length > 0) {
                printLine(`<div style='color: var(--term-warning); margin-top: 4px;'><b>⚠ Tree Warning:</b> ${newAnalysis.disconnectedActive.length} active abilities are now disconnected/invalid:</div>`);
                for (const d of newAnalysis.disconnectedActive.slice(0, 5)) {
                    printLine(`&nbsp;&nbsp;• [#${d.ability.id}] ${escapeHtml(d.ability.display_name)} (<i>${escapeHtml(d.reason)}</i>)`);
                }
                if (newAnalysis.disconnectedActive.length > 5) {
                    printLine(`&nbsp;&nbsp;... and ${newAnalysis.disconnectedActive.length - 5} more.`);
                }
            }
            if (newAnalysis.apUsed > newAnalysis.apCap) {
                printLine(`<span class='term-line-error'><b>⚠ Warning:</b> Assigned AP exceeds cap! (${newAnalysis.apUsed} > ${newAnalysis.apCap})</span>`);
            }
        }
    }

    function showAtreeInfo(args) {
        if (args.length === 0) {
            printLine("Please specify an ability name or ID (e.g. <code>atree info 12</code> or <code>atree info Spin Attack</code>).", "term-line-warn");
            return;
        }

        const query = args.join(" ");
        const res = resolveAtreeNode(query);

        if (res.error) {
            printLine(res.error, "term-line-error");
            return;
        }

        if (res.candidates && res.candidates.length > 1) {
            printLine(`Multiple abilities match '<b>${escapeHtml(query)}</b>':`, "term-line-warn");
            for (const c of res.candidates.slice(0, 10)) {
                printLine(`&nbsp;&nbsp;• [<b>#${c.ability.id}</b>] ${escapeHtml(c.ability.display_name || c.ability.name)}`);
            }
            printLine("Please specify by full name or ID (e.g. <code>atree info " + res.candidates[0].ability.id + "</code>).", "term-line-system");
            return;
        }

        const nodeWrapper = res.match;
        const abil = nodeWrapper.ability;
        const analysis = getAtreeAnalysis();

        const isActive = nodeWrapper.active;
        const isTakable = analysis && analysis.takableNodes.some(t => t.ability.id === abil.id);

        let statusStr = "<span class='atree-status-locked'>[  LOCKED]</span>";
        if (isActive) {
            statusStr = "<span class='atree-status-active'>[✓ ACTIVE]</span>";
        } else if (isTakable) {
            statusStr = "<span class='atree-status-takable'>[+ TAKABLE (Ready to take!)]</span>";
        }

        let out = "<div class='term-box'>";
        out += `<b>=== Ability Details: [#${abil.id}] ${escapeHtml(abil.display_name || abil.name)} ===</b><br/>`;
        out += `Status: ${statusStr}<br/>`;
        out += `Cost: <span class='atree-cost-badge'>${abil.cost} AP</span>`;
        if (abil.archetype) {
            out += ` | Archetype: <span class='atree-arch-badge'>${escapeHtml(abil.archetype)}</span>`;
        }
        if (abil.display) {
            out += ` | Grid: Row ${abil.display.row}, Col ${abil.display.col}`;
        }
        out += "<br/><br/>";

        // Description
        const cleanD = cleanDesc(abil.desc);
        if (cleanD) {
            out += `<b>Description:</b><br/>${cleanD.split("\n").map(l => `&nbsp;&nbsp;${escapeHtml(l)}`).join("<br/>")}<br/><br/>`;
        }

        // Parents
        out += "<b>Parent Connections:</b><br/>";
        if (nodeWrapper.parents.length === 0) {
            out += "&nbsp;&nbsp;<span class='term-line-success'>• None (Starting Root Ability)</span><br/>";
        } else {
            for (const p of nodeWrapper.parents) {
                const pActive = p.active ? "<span class='term-line-success'>[✓]</span>" : "<span class='term-line-system'>[ ]</span>";
                out += `&nbsp;&nbsp;• ${pActive} [#${p.ability.id}] <b>${escapeHtml(p.ability.display_name || p.ability.name)}</b><br/>`;
            }
        }

        // Children
        if (nodeWrapper.children.length > 0) {
            out += "<b>Child Connections:</b><br/>";
            for (const c of nodeWrapper.children) {
                const cActive = c.active ? "<span class='term-line-success'>[✓]</span>" : "<span class='term-line-system'>[ ]</span>";
                out += `&nbsp;&nbsp;• ${cActive} [#${c.ability.id}] <b>${escapeHtml(c.ability.display_name || c.ability.name)}</b><br/>`;
            }
        }

        // Requirements & Restrictions
        let reqs = [];
        if (abil.archetype_req && abil.archetype_req > 0) {
            reqs.push(`Archetype Requirement: ${escapeHtml(abil.req_archetype || abil.archetype)} >= ${abil.archetype_req}`);
        }
        if (abil.dependencies && abil.dependencies.length > 0) {
            const depNames = abil.dependencies.map(id => {
                const dNode = analysis.atree_state.get(id);
                return dNode ? `[#${id}] ${dNode.ability.display_name}` : `#${id}`;
            });
            reqs.push(`Dependencies: ${depNames.join(", ")}`);
        }
        if (abil.blockers && abil.blockers.length > 0) {
            const blkNames = abil.blockers.map(id => {
                const bNode = analysis.atree_state.get(id);
                return bNode ? `[#${id}] ${bNode.ability.display_name}` : `#${id}`;
            });
            reqs.push(`Blocked by: ${blkNames.join(", ")}`);
        }

        if (reqs.length > 0) {
            out += `<br/><b>Requirements & Restrictions:</b><br/>`;
            for (const r of reqs) {
                out += `&nbsp;&nbsp;• ${escapeHtml(r)}<br/>`;
            }
        }

        out += `<br/><small class='term-line-system'>Use <code>atree toggle ${abil.id}</code> to ${isActive ? "deactivate" : "activate"}.</small>`;
        out += "</div>";
        printLine(out);
    }

    function doAtreeReset() {
        if (typeof clearTree === "function" && atree_node && atree_node.value) {
            clearTree(atree_node.value);
        } else if (typeof atree_state_node !== "undefined" && atree_state_node.value) {
            for (const node of atree_state_node.value.values()) {
                if (node.active) {
                    atree_set_state(node, false);
                }
            }
            atree_state_node.mark_dirty().update();
        }
        const analysis = getAtreeAnalysis();
        const cap = analysis ? analysis.apCap : 50;
        printLine(`<span class='term-line-success'>Cleared all ability tree allocations.</span> (0/${cap} AP used)`);
    }

    function showAtreeHelp() {
        const help = `
<div class='term-box'>
<b>Ability Tree (atree) Command Reference:</b>
<table class='term-table'>
  <tr><th style='width: 170px;'>Command</th><th>Description</th></tr>
  <tr><td><b class='term-line-info'>atree</b> (summary)</td><td>Display ability tree summary, AP used/cap, archetypes, and next takable count</td></tr>
  <tr><td><b class='term-line-info'>atree takable</b> (avail)</td><td><b>List only nodes that are currently takable</b> (connected, AP available, reqs met)</td></tr>
  <tr><td><b class='term-line-info'>atree list [filter]</b></td><td>List all abilities for current class (optional filter: active, takable, archetype, search)</td></tr>
  <tr><td><b class='term-line-info'>atree toggle &lt;name|id&gt;</b></td><td>Toggle an ability node on or off (e.g. <code>atree toggle Spin Attack</code> or <code>atree toggle 12</code>)</td></tr>
  <tr><td><b class='term-line-info'>atree take &lt;name|id&gt;</b></td><td>Activate an ability node</td></tr>
  <tr><td><b class='term-line-info'>atree remove &lt;name|id&gt;</b></td><td>Deactivate an ability node (alias: <code>atree rm</code>)</td></tr>
  <tr><td><b class='term-line-info'>atree info &lt;name|id&gt;</b></td><td>Inspect full details: description, AP cost, parent/child nodes, and requirements</td></tr>
  <tr><td><b class='term-line-info'>atree reset</b> (clear)</td><td>Deactivate all ability tree nodes</td></tr>
</table>
<i>Tip: Press <b>Tab</b> after <code>atree toggle </code> to autocomplete ability names!</i>
</div>`;
        printLine(help);
    }

    // Expose CLI functions globally for DOM button callbacks
    window.wbCLI = {
        executeCommand,
        cmdGui,
        cmdAtree
    };

    // Auto-boot CLI when document is ready
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initCLI);
    } else {
        initCLI();
    }
})();

