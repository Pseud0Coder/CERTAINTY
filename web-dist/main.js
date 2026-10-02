/* Login decides the application (master prompt section 7). */
import { api } from './shared/api.js';
import { h, stamp, toast, clear, themeToggle, brandLockup } from './shared/dom.js';
const root = document.getElementById('root');
function render() {
    clear(root);
    const login = h('div', { class: 'login' });
    const themeSlot = h('div', { class: 'pin-tr' }, themeToggle());
    root.append(themeSlot);
    /* The wordmark, the promise, then the build stamp. The stamp is wrapped
       because the panel is a column flexbox: an unwrapped inline element
       stretches to the full column width and reads as an empty input. */
    const demoStamp = h('span', {});
    const panel = h('div', { class: 'panel' }, h('div', { class: 'login-head' }, brandLockup({ large: true }), h('p', { class: 't-secondary login-promise' }, 'What a candidate claimed, separated from what is verified.'), h('div', { class: 'login-stamp' }, demoStamp)), h('div', { class: 'field' }, h('label', { class: 't-secondary', for: 'email' }, 'Email'), h('input', { type: 'email', id: 'email', autocomplete: 'username' })), h('div', { class: 'field' }, h('label', { class: 't-secondary', for: 'password' }, 'Password'), h('input', { type: 'password', id: 'password', autocomplete: 'current-password' })));
    const btn = h('button', { class: 'btn btn-primary' }, 'Sign in');
    btn.addEventListener('click', async () => {
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        if (!email || !password) {
            toast('Enter your email and password');
            return;
        }
        try {
            const me = await api.post('/api/auth/login', { email, password });
            const role = me.user.role;
            location.href = role === 'candidate' ? '/app/candidate' : role === 'admin' ? '/app/admin' : '/app/recruiter';
        }
        catch (e) {
            toast(String(e.message) === 'invalid_credentials' ? 'That email and password do not match.' : 'Sign in failed.');
        }
    });
    panel.append(btn);
    /* Demo accounts, one per line and clickable: a wall of comma-separated
       addresses is the slowest possible way to hand someone a demo. */
    /* Demo accounts appear only on a demo deployment (CERTAINTY_DEMO is not
       "off"); a real tenant's sign-in page never lists credentials. */
    const demo = h('div', { class: 'demo', hidden: 'true' });
    fetch('/api/public/config').then(r => r.json()).then((cfg) => {
        if (!cfg.demo)
            return;
        demo.hidden = false;
        demoStamp.replaceWith(stamp('Demo environment, fictional data'));
    }).catch(() => { });
    demo.append(h('div', { class: 't-caption demo-head' }, 'Demo accounts'));
    for (const [email, role] of [
        ['admin@gennext.demo', 'Admin'],
        ['recruiter@gennext.demo', 'Recruiter'],
        ['nadia@gennext.demo', 'Candidate, profile complete'],
        ['priya@gennext.demo', 'Candidate, halfway through onboarding'],
        ['owen@gennext.demo', 'Candidate, just starting'],
    ]) {
        const row = h('button', { class: 'demo-row', type: 'button', title: `Fill ${role} credentials` }, h('span', { class: 'demo-mail' }, email), h('span', { class: 'demo-role' }, role));
        row.addEventListener('click', () => {
            document.getElementById('email').value = email;
            document.getElementById('password').value = 'certainty-demo';
            btn.focus();
        });
        demo.append(row);
    }
    demo.append(h('div', { class: 't-caption demo-pw' }, 'Password: certainty-demo'));
    panel.append(demo);
    login.append(panel);
    root.append(login);
    /* Enter submits from either field, not only the password. */
    for (const id of ['email', 'password']) {
        document.getElementById(id).addEventListener('keydown', e => {
            if (e.key === 'Enter')
                btn.click();
        });
    }
    document.getElementById('email').focus();
}
render();
