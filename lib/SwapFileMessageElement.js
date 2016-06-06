'use babel'

/**
 * Represents the command line (:) or information line. When in command mode
 * will show what you are typing, when not in command mode show's other
 * information etc
 */
class SwapFileMessageElement extends HTMLDivElement {

    init() {
        this.messageContainer = document.createElement("div");
        this.message = document.createElement("pre");
        this.messageContainer.appendChild(this.message);                                                               
        this.classList.add('neovimbed-swap-file-message');
        this.appendChild(this.messageContainer);
        this.panel = atom.workspace.addTopPanel({
            item: this,
            priority: 100
        });
        this.show();
    };

    setText(text) {
        this.message.innerHTML = text;
    }

    show() {
        this.panel.show();
    }

    hide() {
        this.panel.hide();
    }

}

export default document.registerElement("neovimbed-swap-file-message", {
  extends: "div",
  prototype: SwapFileMessageElement.prototype
})