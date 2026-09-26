"use strict";
/* Interview + voice design review: lets each concept's state switcher
   (Idle / Listening / AI speaking / Muted) actually repaint the mockup,
   and a theme toggle so every concept can be checked in both themes.
   Review-only; not part of the shipped app. */
const STATE_LABEL = {
    idle: 'Idle', listening: 'Listening', speaking: 'Speaking', muted: 'Muted',
};
const ORB_LABEL = {
    idle: 'Idle', listening: 'Listening to you', speaking: 'Certainty is speaking', muted: 'Muted',
};
function isVoiceState(s) {
    return s === 'idle' || s === 'listening' || s === 'speaking' || s === 'muted';
}
document.querySelectorAll('.statesw').forEach(sw => {
    const targetId = sw.dataset.target;
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target)
        return;
    sw.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            const state = btn.dataset.state;
            if (!isVoiceState(state))
                return;
            sw.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
            btn.setAttribute('aria-pressed', 'true');
            target.className = target.className.replace(/vstate-\S+/, '').trim() + ' vstate-' + state;
            const vlabel = target.querySelector('.vlabel');
            if (vlabel)
                vlabel.textContent = ORB_LABEL[state];
            const ringState = target.querySelector('.ringcenter .st');
            if (ringState)
                ringState.textContent = STATE_LABEL[state];
            const pill = target.querySelector('.voicepill');
            if (pill?.lastChild)
                pill.lastChild.textContent = ' ' + STATE_LABEL[state];
        });
    });
});
const themeBtn = document.getElementById('themeBtn');
themeBtn?.addEventListener('click', () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
    themeBtn.textContent = dark ? 'Dark mode' : 'Light mode';
});
