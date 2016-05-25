'use babel'

/**
 * Represents the command line (:) or information line. When in command mode
 * will show what you are typing, when not in command mode show's other
 * information as per VIM (eg. -- INSERT --, -- VISUAL --, last change
 * information etc
 */
class CommandLineInputElement extends HTMLDivElement {

    init() {
        this.commandLine = document.createElement("div");
        this.classList.add('neovimbed-command-line-input'); 
        this.appendChild(this.commandLine);
        this.panel = atom.workspace.addBottomPanel({
            item: this,
            priority: 100
        });
        this.show();
    };

    setText(text) {
        this.commandLine.innerHTML = text;
    }

    show() {
        this.panel.show();
    }

    hide() {
        this.panel.hide();
    }

}

export default document.registerElement("neovimbed-command-line-input", {
  extends: "div",
  prototype: CommandLineInputElement.prototype
})
