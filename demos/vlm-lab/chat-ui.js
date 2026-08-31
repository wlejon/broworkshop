// demos/vlm-lab/chat-ui.js

export class ChatUI {
    constructor(chatHistoryElement, groundedTagsElement) {
        this.history = chatHistoryElement;
        this.tags = groundedTagsElement;
    }

    appendUserMessage(text) {
        const msg = document.createElement('div');
        msg.className = 'chat-msg user';
        msg.innerHTML = `
            <div class="msg-avatar">👤</div>
            <div class="msg-body"><p>${this.escapeHtml(text)}</p></div>
        `;
        this.history.appendChild(msg);
        this.scrollToBottom();
    }

    createAssistantMessage() {
        const msg = document.createElement('div');
        msg.className = 'chat-msg assistant';
        msg.innerHTML = `
            <div class="msg-avatar">🤖</div>
            <div class="msg-body"><p class="streaming-body"></p></div>
        `;
        this.history.appendChild(msg);
        this.scrollToBottom();
        return msg.querySelector('.streaming-body');
    }

    updateGroundedTags(boxes) {
        this.tags.innerHTML = '';
        if (!boxes || boxes.length === 0) {
            this.tags.innerHTML = '<span class="tag-pill">No active boxes</span>';
            return;
        }

        for (const b of boxes) {
            const pill = document.createElement('span');
            pill.className = 'tag-pill';
            pill.textContent = b.label || 'Entity';
            this.tags.appendChild(pill);
        }
    }

    clear() {
        this.history.innerHTML = `
            <div class="chat-msg assistant">
                <div class="msg-avatar">🤖</div>
                <div class="msg-body">
                    <p>Chat cleared. Ready for your visual reasoning prompt.</p>
                </div>
            </div>
        `;
        this.updateGroundedTags([]);
    }

    scrollToBottom() {
        this.history.scrollTop = this.history.scrollHeight;
    }

    escapeHtml(str) {
        return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
