/**
 * Login, doubling as the pitch page.
 *
 * The persona list is what makes the demo work in a room: the argument only
 * lands once people watch the same dossier from the supplier's, the producer's
 * and the verifier's side within a minute of each other.
 */
import { api } from '../lib/api.js';
import { tags, mount, formData } from '../lib/dom.js';
import { toast } from '../lib/ui.js';

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

  const demo = await api.get('/auth/demo-accounts').catch(() => ({ accounts: [], password: null }));
  const errorHost = div();

  const loginForm = form(
    {
      onSubmit: async (event) => {
        event.preventDefault();
        const values = formData(loginForm);
        const submit = loginForm.querySelector('button[type=submit]');
        submit.disabled = true;
        mount(errorHost);
        try {
          const session = await api.post('/auth/login', values);
          await onAuthenticated(session);
        } catch (err) {
          mount(errorHost, div({ class: 'note note--bad' }, span({ class: 'note__icon' }, '✕'), div({}, err.message)));
          submit.disabled = false;
        }
      },
    },
    div(
      { class: 'field' },
      label({ class: 'field__label' }, 'E-mailadres'),
      input({ type: 'email', name: 'email', required: true, autocomplete: 'username', placeholder: 'naam@bedrijf.be' }),
    ),
    div(
      { class: 'field' },
      label({ class: 'field__label' }, 'Wachtwoord'),
      input({ type: 'password', name: 'password', required: true, autocomplete: 'current-password' }),
    ),
    errorHost,
    button({ type: 'submit', class: 'btn btn--primary', style: { width: '100%' } }, 'Aanmelden'),
  );

  const personas = demo.accounts.length
    ? div(
        { class: 'login__demo' },
        h3({}, `Demo-accounts · wachtwoord ${demo.password}`),
        p({ class: 'tiny muted', style: { marginBottom: '10px' } }, 'Klik een rol aan om het platform vanuit die partij te bekijken.'),
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
            span({}, div({ class: 'persona__name' }, account.name), div({ class: 'persona__org' }, account.org_name)),
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
          li({}, i({}, '3'), span({}, b({}, 'Wijzigen zonder stilstand. '), 'Kleine receptuurwijzigingen erven de bestaande verificatie; grote gaan naar de verificateur. Met een plafond op de opgetelde drift.')),
          li({}, i({}, '4'), span({}, b({}, 'Ieder zijn module. '), 'A1–A3 bij de producent, A4–A5 bij wie ze effectief uitvoert. Wie wat invulde staat vast in de audittrail.')),
          li({}, i({}, '5'), span({}, b({}, 'Sectorgemiddelden mét spreiding. '), 'Voor de ontwerpfase, altijd samen met de bandbreedte — want die is het halve verhaal.')),
        ),
        p({ class: 'mt-2', style: { fontSize: '12px', opacity: 0.6 } }, 'EN 15804+A2 · modules A1 t.e.m. A5 · demonstratieopstelling'),
      ),
      div(
        { class: 'login__form' },
        div(
          { class: 'login__box' },
          h2({ style: { fontSize: '19px', marginBottom: '4px' } }, 'Aanmelden'),
          p({ class: 'muted small', style: { marginBottom: '18px' } }, 'Toegang is gebonden aan uw organisatie en rol.'),
          loginForm,
          personas,
          small(
            { class: 'muted tiny', style: { display: 'block', marginTop: '18px' } },
            'In productie vervangt een aanmelding via de identiteitsprovider van uw organisatie (Entra ID) dit scherm.',
          ),
        ),
      ),
    ),
  );
}
