'use babel'

class ExModeCommandInputElement extends HTMLDivElement {


    init() {
        this.editorElement = document.createElement("atom-text-editor");
        this.editorElement.classList.add('editor');
        this.editorElement.classList.add('rofl');
        this.editor = this.editorElement.getModel();
        this.editor.setMini(true);
        this.editorElement.setAttribute('mini', '');
        this.classList.add('ex-mode-command-input'); 
        this.appendChild(this.editorElement);
        this.panel = atom.workspace.addBottomPanel({
            item: this,
            priority: 100
        });
        this.editorElement.focus();
    };

    focus() {
        this.panel.show();
        this.editorElement.focus();
    }

    show() {
        this.panel.show();
    }

    hide() {
        this.panel.hide();
    }

}

export default document.registerElement("ex-mode-command-input", {
  extends: "div",
  prototype: ExModeCommandInputElement.prototype
})
