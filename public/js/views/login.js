/**
 * Aanmelden, tegelijk de pitchpagina.
 *
 * De personalijst maakt de demo in een vergaderzaal: het argument landt pas
 * wanneer mensen hetzelfde dossier binnen de minuut vanuit de leverancier, de
 * producent en de verificateur zien.
 */
import { api } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { toast, btn, banner } from '../lib/ui.js';
import { icon } from '../lib/icons.js';

const { div, form, h1, h2, h3, p, ul, li, i, b, label, input, button, span, small } = tags;

const ORG_LABELS = {
  SUPPLIER: 'Leverancier',
  PRODUCER: 'Producent',
  CONTRACTOR: 'Aannemer',
  VERIFIER: 'Verificateur',
  FEDERATION: 'Federatie',
  REGULATOR: 'Overheid',
};

export async function renderLogin(root, onAuthenticated) {
  root.className = '';
  document.title = 'Aanmelden — Materia';

  const demo = await api.get('/auth/demo-accounts').catch(() => ({ accounts: [], password: null }));
  const errorHost = div();

  const loginForm = form(
    { class: 'flex-col', style: { gap: '11.2px' } },
    div({ class: 'field' }, label({}, 'E-mailadres'), input({ class: 'input', type: 'email', name: 'email', required: true, autocomplete: 'username', placeholder: 'naam@bedrijf.be' })),
    div({ class: 'field' }, label({}, 'Wachtwoord'), input({ class: 'input', type: 'password', name: 'password', required: true, autocomplete: 'current-password' })),
    errorHost,
    button({ type: 'submit', class: 'btn btn-primary', style: { width: '100%' } }, 'Aanmelden'),
  );

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submit = loginForm.querySelector('button[type=submit]');
    submit.disabled = true;
    mount(errorHost);
    try {
      const session = await api.post('/auth/login', formData(loginForm));
      await onAuthenticated(session);
    } catch (err) {
      mount(errorHost, banner('neutral', { icon: 'warning', body: err.message }));
      submit.disabled = false;
    }
  });

  const personas = demo.accounts.length
    ? div(
        { class: 'login__demo' },
        h3({ class: 'card-kicker', style: { marginBottom: '5.6px' } }, `Demo-accounts · wachtwoord ${demo.password}`),
        p({ class: 'tiny muted', style: { marginBottom: '11.2px' } }, 'Klik een rol aan om het platform vanuit die partij te bekijken.'),
        demo.accounts.map((account) =>
          button(
            {
              class: 'persona',
              type: 'button',
              onClick: async () => {
                try {
                  const session = await api.post('/auth/login', { email: account.email, password: demo.password });
                  await onAuthenticated(session);
                } catch (err) {
                  toast(err.message, 'bad');
                }
              },
            },
            span({ class: 'persona__role' }, ORG_LABELS[account.org_type] ?? account.org_type),
            span({ class: 'grow' }, div({ class: 'persona__name' }, account.name), div({ class: 'persona__org' }, account.org_name)),
            icon('arrowRight', { size: 14, className: 'muted' }),
          ),
        ),
      )
    : null;

  mount(
    root,
    div(
      { class: 'login' },
      div(
        { class: 'login__pitch' },
        div({ class: 'flex', style: { marginBottom: '22.4px' } },
          span({ style: { fontWeight: 600, fontSize: '17px', letterSpacing: '-0.02em', color: '#fff' } }, 'Materia'),
          span({ class: 'chip-poc', style: { color: 'var(--color-accent-300)', borderColor: 'color-mix(in srgb, #fff 22%, transparent)' } }, 'Proof of concept'),
        ),
        h1({}, 'Het milieuprofiel van beton, van groeve tot werf.'),
        p(
          {},
          'Vanaf 2028 moet het E-peil van een woning ook de milieu-impact van de gebruikte materialen bevatten, en vanaf 2030 hoort die impact bij de CE-markering van beton. ',
          'Dat vraagt een berekening per receptuur, per centrale en per levering — niet één gemiddelde voor heel België.',
        ),
        ul(
          { class: 'login__points' },
          li({}, i({}, '1'), span({}, b({}, 'Ketenbewijs. '), 'Elke grondstof draagt haar eigen BEPD. Ontbreekt er één, dan is het eindresultaat ongeldig — niet "ongeveer juist".')),
          li({}, i({}, '2'), span({}, b({}, 'Transparante rekenregels. '), 'Elke term toont zijn formule, zijn factor en de bron van die factor. Eén knop levert het volledige dossier.')),
          li({}, i({}, '3'), span({}, b({}, 'Wijzigen zonder stilstand. '), 'Kleine receptuurwijzigingen erven de bestaande verificatie; grote gaan naar het controlebureau. Met een plafond op de opgetelde drift.')),
          li({}, i({}, '4'), span({}, b({}, 'Ieder zijn module. '), 'A1–A3 bij de producent, A4–A5 bij wie ze effectief uitvoert. Wie wat invulde staat vast in de log.')),
          li({}, i({}, '5'), span({}, b({}, 'Sectorwaarden mét spreiding. '), 'Voor de ontwerpfase, altijd samen met de bandbreedte — want die is het halve verhaal.')),
        ),
        p({ class: 'mt-3 tiny', style: { opacity: 0.5 } }, 'EN 15804+A2 · EN 16757 · modules A1 t.e.m. A5'),
      ),
      div(
        { class: 'login__form' },
        div(
          { class: 'login__box' },
          div({}, h2({ style: { fontSize: '22px' } }, 'Aanmelden'), p({ class: 'muted small', style: { margin: '2.8px 0 0' } }, 'Toegang is gebonden aan uw organisatie en rol.')),
          loginForm,
          personas,
          small({ class: 'muted tiny' }, 'In productie vervangt een aanmelding via de identiteitsprovider van uw organisatie (Entra ID) dit scherm.'),
        ),
      ),
    ),
  );
}
