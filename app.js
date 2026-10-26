/* Entre Regalos - frontend. La seguridad real está en las políticas RLS y funciones SQL. */
(() => {
  'use strict';

  const config = window.APP_CONFIG || {};
  const authView = document.getElementById('auth-view');
  const roomView = document.getElementById('room-view');
  const headerActions = document.getElementById('header-actions');
  const authNotice = document.getElementById('auth-notice');
  const toastRegion = document.getElementById('toast-region');
  const tabs = [...document.querySelectorAll('[data-auth-tab]')];
  const forms = {
    login: document.getElementById('login-form'),
    join: document.getElementById('join-form'),
    create: document.getElementById('create-form')
  };
  const titles = {
    login: ['¡Qué bueno verte!', 'Entra con tu correo, contraseña y código de sala.'],
    join: ['¡Súmate al sorteo!', 'Crea tu cuenta y únete a la sala de tu familia.'],
    create: ['¡Crea una nueva tradición!', 'Crea una sala con una cuenta nueva o con tu cuenta existente.']
  };

  let roomPollTimer = null;

  const state = {
    client: null,
    user: null,
    room: null,
    profile: null,
    participants: [],
    ownParticipant: null,
    assignmentId: null,
    assignmentName: null,
    messages: [],
    revealedThisVisit: false,
    busy: false,
    authTab: 'login'
  };

  const params = new URLSearchParams(window.location.search);
  const queryCode = (params.get('sala') || '').trim().toUpperCase();
  const isPlaceholder = value => !value || value.includes('PEGA_AQUI_') || value.includes('YOUR_');
  const codeForUser = userId => `entre-regalos-last-room:${userId}`;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[char]);
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase() || '?';
  }

  function niceDate(value) {
    try {
      return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch (_) { return ''; }
  }

  function setBusy(isBusy, label = 'Estamos preparando todo...') {
    state.busy = isBusy;
    let overlay = document.getElementById('loading-overlay');
    if (isBusy) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'loading-overlay';
        overlay.className = 'loading-overlay';
        overlay.innerHTML = '<div class="loading-card"><span class="spinner" aria-hidden="true"></span><strong id="loading-label"></strong></div>';
        document.body.appendChild(overlay);
      }
      const labelNode = document.getElementById('loading-label');
      if (labelNode) labelNode.textContent = label;
    } else if (overlay) {
      overlay.remove();
    }
  }

  function toast(message, type = 'success') {
    const node = document.createElement('div');
    node.className = `toast ${type === 'error' ? 'error' : ''}`;
    node.textContent = message;
    toastRegion.appendChild(node);
    window.setTimeout(() => node.remove(), 5200);
  }

  function showNotice(message, type = 'success') {
    authNotice.textContent = message;
    authNotice.className = `notice ${type}`;
    authNotice.classList.remove('hidden');
  }

  function clearNotice() {
    authNotice.textContent = '';
    authNotice.className = 'notice hidden';
  }

  function showAuth(tab = 'login', notice = null, noticeType = 'success') {
    state.authTab = tab;
    authView.classList.remove('hidden');
    roomView.classList.add('hidden');
    roomView.innerHTML = '';
    const title = document.getElementById('auth-title');
    const subtitle = document.getElementById('auth-subtitle');
    [title.textContent, subtitle.textContent] = titles[tab] || titles.login;
    tabs.forEach(button => {
      const active = button.dataset.authTab === tab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    Object.entries(forms).forEach(([key, form]) => form.classList.toggle('hidden', key !== tab));
    clearNotice();
    if (notice) showNotice(notice, noticeType);
    const inviteValue = queryCode || (state.user ? localStorage.getItem(codeForUser(state.user.id)) : '') || '';
    document.querySelectorAll('input[name="inviteCode"]').forEach(input => {
      if (!input.value) input.value = inviteValue;
    });
    renderHeader();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderHeader() {
    if (state.user && state.room) {
      headerActions.innerHTML = `<span class="header-user">${escapeHtml(state.profile?.full_name || state.user.email || 'Participante')}</span><button type="button" class="btn btn-secondary" data-action="signout">Cerrar sesión</button>`;
    } else if (state.user) {
      headerActions.innerHTML = `<span class="header-user">Sesión activa</span><button type="button" class="btn btn-secondary" data-action="signout">Cerrar sesión</button>`;
    } else {
      headerActions.innerHTML = '';
    }
  }

  function formatError(error) {
    const raw = error?.message || 'Ocurrió un error inesperado. Inténtalo de nuevo.';
    const mappings = [
      [/Invalid login credentials/i, 'El correo o la contraseña no son correctos.'],
      [/Email not confirmed/i, 'Debes confirmar tu correo. Abre el enlace que recibiste y vuelve a entrar.'],
      [/User already registered/i, 'Ese correo ya tiene una cuenta. Usa “Iniciar sesión” para entrar.'],
      [/Password should be at least/i, 'La contraseña debe tener al menos 8 caracteres.'],
      [/rate limit|too many requests/i, 'Se hicieron demasiados intentos seguidos. Espera un momento y prueba otra vez.'],
      [/duplicate key value/i, 'Este registro ya existe. Revisa si ya estás inscrito en la sala.'],
      [/Las inscripciones de esta sala ya están cerradas/i, 'Las inscripciones de esta sala ya están cerradas.'],
      [/No encontramos una sala/i, 'No encontramos una sala con ese código. Revisa la invitación.'],
      [/Tu cuenta no pertenece/i, 'Tu cuenta no está inscrita en esa sala. Usa “Registrarme” si está abierta.'],
      [/Debes iniciar sesión/i, 'Tu sesión terminó. Inicia sesión nuevamente.']
    ];
    const match = mappings.find(([pattern]) => pattern.test(raw));
    return match ? match[1] : raw.replace(/^.*ERROR:\s*/i, '').replace(/^PGRST\d+:\s*/i, '');
  }

  async function requireConfigured() {
    if (isPlaceholder(config.SUPABASE_URL) || isPlaceholder(config.SUPABASE_ANON_KEY)) {
      const message = 'Falta conectar Supabase. Abre config.js y pega la URL del proyecto y la clave publicable/anon. Sigue la guía README.md.';
      showAuth('login', message, 'error');
      Object.values(forms).forEach(form => form.querySelectorAll('button[type="submit"]').forEach(button => { button.disabled = true; }));
      return false;
    }
    if (!window.supabase?.createClient) {
      showAuth('login', 'No se pudo cargar la biblioteca de conexión. Revisa tu conexión a internet y recarga la página.', 'error');
      return false;
    }
    state.client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY);
    return true;
  }

  async function init() {
    const resetMode = params.get('reset') === '1';
    if (!await requireConfigured()) return;

    // Completa el flujo de recuperación si se llega desde el enlace de correo.
    if (resetMode) {
      await renderPasswordReset();
      return;
    }

    const { data, error } = await state.client.auth.getSession();
    if (error) console.warn('No se pudo recuperar la sesión:', error.message);
    if (data?.session?.user) {
      state.user = data.session.user;
      renderHeader();
      const code = queryCode || localStorage.getItem(codeForUser(state.user.id)) || '';
      if (code) {
        try {
          setBusy(true, 'Abriendo tu sala...');
          await enterRoom(code, true);
          setBusy(false);
          return;
        } catch (error) {
          setBusy(false);
          showAuth('login', formatError(error), 'error');
          return;
        }
      }
      showAuth('login', 'Tu sesión sigue activa. Escribe el código de una sala a la que ya pertenezcas para continuar.', 'success');
      return;
    }
    showAuth(queryCode ? 'login' : 'login');
  }

  async function renderPasswordReset() {
    const { data } = await state.client.auth.getSession();
    authView.classList.remove('hidden');
    roomView.classList.add('hidden');
    tabs.forEach(tab => tab.classList.add('hidden'));
    Object.values(forms).forEach(form => form.classList.add('hidden'));
    document.getElementById('auth-title').textContent = 'Crea una nueva contraseña';
    document.getElementById('auth-subtitle').textContent = data?.session ? 'Elige una contraseña que puedas recordar.' : 'El enlace puede haber vencido. Solicita uno nuevo desde Iniciar sesión.';
    const card = document.querySelector('.auth-card');
    let resetForm = document.getElementById('reset-form');
    if (!resetForm) {
      resetForm = document.createElement('form');
      resetForm.id = 'reset-form';
      resetForm.className = 'auth-form';
      resetForm.innerHTML = `<label>Nueva contraseña<input name="password" type="password" autocomplete="new-password" minlength="8" required placeholder="Mínimo 8 caracteres"></label><label>Repite la contraseña<input name="passwordConfirm" type="password" autocomplete="new-password" minlength="8" required placeholder="Escríbela otra vez"></label><button type="submit" class="btn btn-primary btn-full">Guardar contraseña</button><button type="button" class="text-button" data-action="back-to-login">Volver al inicio de sesión</button>`;
      card.insertBefore(resetForm, document.querySelector('.security-note'));
      resetForm.addEventListener('submit', async event => {
        event.preventDefault();
        const formData = new FormData(resetForm);
        const password = String(formData.get('password') || '');
        const passwordConfirm = String(formData.get('passwordConfirm') || '');
        if (password.length < 8) return showNotice('La contraseña debe tener al menos 8 caracteres.', 'error');
        if (password !== passwordConfirm) return showNotice('Las contraseñas no coinciden.', 'error');
        setBusy(true, 'Actualizando tu contraseña...');
        const { error } = await state.client.auth.updateUser({ password });
        setBusy(false);
        if (error) return showNotice(formatError(error), 'error');
        await state.client.auth.signOut();
        window.history.replaceState({}, document.title, window.location.pathname);
        resetForm.remove();
        tabs.forEach(tab => tab.classList.remove('hidden'));
        showAuth('login', 'Tu contraseña se actualizó. Ya puedes iniciar sesión.', 'success');
      });
    }
    resetForm.classList.toggle('hidden', !data?.session);
    if (!data?.session) showNotice('No hay una sesión de recuperación activa. Solicita un nuevo enlace desde “Olvidé mi contraseña”.', 'error');
    else clearNotice();
  }

  tabs.forEach(button => button.addEventListener('click', () => showAuth(button.dataset.authTab)));

  forms.create.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;

    const formData = new FormData(forms.create);
    const fullName = String(formData.get('fullName') || '').trim();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    const roomName = String(formData.get('roomName') || '').trim();

    if (password.length < 8) return showNotice('Usa una contraseña de al menos 8 caracteres.', 'error');
    if (roomName.length < 3 || roomName.length > 80) return showNotice('El nombre de la sala debe tener entre 3 y 80 caracteres.', 'error');

    setBusy(true, 'Preparando tu nueva sala...');
    try {
      let isNewAccount = false;

      // Si ya hay una sesión activa, creamos la sala con esa cuenta sin registrar otra vez.
      if (state.user) {
        const activeEmail = String(state.user.email || '').trim().toLowerCase();
        if (activeEmail && activeEmail !== email) {
          throw new Error(`Ya tienes una sesión activa con ${activeEmail}. Usa ese correo para crear la sala o cierra sesión antes de utilizar otra cuenta.`);
        }
      } else {
        // Intentamos crear la cuenta. Si ya existe, usamos la misma cuenta para
        // crear una nueva sala. Algunas configuraciones de Auth pueden devolver
        // un usuario sin sesión en vez de un error explícito cuando el correo existe;
        // por eso también intentamos iniciar sesión cuando signUp no devuelve sesión.
        const { data: signUpData, error: signUpError } = await state.client.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } }
        });

        const accountAlreadyExists = Boolean(signUpError && /user already registered|already registered|already exists|email.*already|already been registered/i.test(signUpError.message || ''));

        if (accountAlreadyExists || (!signUpError && (!signUpData?.session || !signUpData?.user))) {
          const { data: signInData, error: signInError } = await state.client.auth.signInWithPassword({ email, password });
          if (signInError) {
            if (/invalid login credentials|invalid email or password/i.test(signInError.message || '')) {
              throw new Error('No se pudo iniciar sesión con ese correo y contraseña. Si el correo ya tiene una cuenta, escribe la contraseña que usas normalmente. Si olvidaste la contraseña, entra en “Iniciar sesión” y utiliza “Olvidé mi contraseña”.');
            }
            if (/email not confirmed/i.test(signInError.message || '')) {
              throw new Error('La cuenta requiere confirmación de correo. En Supabase revisa Authentication → Sign In / Providers → Email y desactiva Confirm email para este flujo.');
            }
            // Si el signUp había devuelto un error distinto a correo duplicado,
            // ese error original es más útil que el intento de inicio de sesión.
            if (signUpError && !accountAlreadyExists) throw signUpError;
            throw signInError;
          }
          if (!signInData?.user) throw new Error('Supabase no devolvió un usuario después de iniciar sesión.');
          state.user = signInData.user;
          isNewAccount = false;
        } else {
          if (signUpError) throw signUpError;
          if (!signUpData?.session || !signUpData?.user) {
            throw new Error('No se pudo iniciar sesión después del registro. Revisa la opción Confirm email en Supabase y vuelve a intentarlo.');
          }
          state.user = signUpData.user;
          isNewAccount = true;
        }
      }

      const { data: roomData, error: roomError } = await state.client.rpc('create_room', { p_name: roomName });
      if (roomError) throw roomError;

      await enterReturnedRoom(roomData);
      toast(isNewAccount
        ? '¡Cuenta y sala creadas! Comparte el código con tu familia.'
        : '¡Nueva sala creada con tu cuenta! Puedes reutilizar el mismo correo para otros sorteos.');
    } catch (error) {
      setBusy(false);
      showNotice(formatError(error), 'error');
    }
  });

  forms.join.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;
    const mode = event.submitter?.dataset.joinMode || 'now';
    const formData = new FormData(forms.join);
    const fullName = String(formData.get('fullName') || '').trim();
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    const inviteCode = String(formData.get('inviteCode') || '').trim().toUpperCase();
    if (!/^[A-F0-9]{12}$/.test(inviteCode)) return showNotice('El código de sala debe tener 12 caracteres. Copia el código tal como te lo compartieron.', 'error');
    if (password.length < 8) return showNotice('Usa una contraseña de al menos 8 caracteres.', 'error');

    setBusy(true, mode === 'now' ? 'Creando tu cuenta y entrando a la sala...' : 'Registrándote en la sala...');
    try {
      const { data, error } = await state.client.auth.signUp({
        email, password,
        options: { data: { full_name: fullName } }
      });
      if (error) throw error;
      if (!data.session) {
        showNotice('Supabase está pidiendo confirmar el correo antes de entrar. Para el flujo directo que buscamos, revisa la guía y desactiva “Confirm email” en Authentication → Sign In / Providers → Email. Después vuelve a registrarte.', 'error');
        setBusy(false);
        return;
      }
      state.user = data.user;
      const { data: roomData, error: roomError } = await state.client.rpc('join_room', { p_invite_code: inviteCode });
      if (roomError) throw roomError;
      localStorage.setItem(codeForUser(state.user.id), inviteCode);
      if (mode === 'later') {
        await state.client.auth.signOut();
        state.user = null;
        state.room = null;
        setBusy(false);
        showAuth('login', '¡Listo! Ya quedaste registrado en la sala. Puedes iniciar sesión más tarde con tu correo, contraseña y código.', 'success');
        document.querySelector('#login-form [name="inviteCode"]').value = inviteCode;
        return;
      }
      await enterReturnedRoom(roomData);
      toast('¡Ya estás en la sala!');
    } catch (error) {
      setBusy(false);
      showNotice(formatError(error), 'error');
    }
  });

  forms.login.addEventListener('submit', async event => {
    event.preventDefault();
    if (state.busy) return;
    const formData = new FormData(forms.login);
    const email = String(formData.get('email') || '').trim().toLowerCase();
    const password = String(formData.get('password') || '');
    const inviteCode = String(formData.get('inviteCode') || '').trim().toUpperCase();
    setBusy(true, 'Verificando tus datos...');
    try {
      const { data, error } = await state.client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.user = data.user;
      if (!/^[A-F0-9]{12}$/.test(inviteCode)) throw new Error('Escribe el código de 12 caracteres de una sala a la que pertenezcas.');
      localStorage.setItem(codeForUser(state.user.id), inviteCode);
      try {
        await enterRoom(inviteCode, false);
        toast('Sesión iniciada. ¡Bienvenido/a de nuevo!');
      } catch (roomEntryError) {
        // Si la cuenta existe pero todavía no pertenece a esta sala, el código funciona como invitación.
        // join_room solo añade a la persona si la sala continúa abierta.
        if (/Tu cuenta no pertenece/i.test(roomEntryError?.message || '')) {
          const { data: joinedRoom, error: joinError } = await state.client.rpc('join_room', { p_invite_code: inviteCode });
          if (joinError) throw joinError;
          await enterReturnedRoom(joinedRoom);
          toast('Tu cuenta ya quedó inscrita en esta sala.');
        } else {
          throw roomEntryError;
        }
      }
    } catch (error) {
      setBusy(false);
      showNotice(formatError(error), 'error');
    }
  });

  document.getElementById('forgot-password').addEventListener('click', async () => {
    if (!state.client) return;
    const email = String(forms.login.querySelector('[name="email"]').value || '').trim().toLowerCase();
    if (!email) return showNotice('Escribe primero tu correo electrónico y vuelve a pulsar “Olvidé mi contraseña”.', 'error');
    setBusy(true, 'Enviando el enlace de recuperación...');
    const redirectTo = `${window.location.origin}${window.location.pathname}?reset=1`;
    const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo });
    setBusy(false);
    if (error) return showNotice(formatError(error), 'error');
    showNotice('Si el correo está registrado, recibirás un enlace para cambiar la contraseña. Revisa también spam o correo no deseado.', 'success');
  });

  async function enterRoom(inviteCode, quiet) {
    const { data, error } = await state.client.rpc('enter_room', { p_invite_code: inviteCode.trim().toUpperCase() });
    if (error) throw error;
    await enterReturnedRoom(data, quiet);
  }

  async function enterReturnedRoom(roomData, quiet = false) {
    state.room = roomData;
    if (!state.user) {
      const { data } = await state.client.auth.getUser();
      state.user = data?.user || null;
    }
    if (!state.user) throw new Error('Tu sesión terminó. Inicia sesión e inténtalo de nuevo.');
    localStorage.setItem(codeForUser(state.user.id), roomData.invite_code);
    state.revealedThisVisit = false;
    await loadRoomData();
    authView.classList.add('hidden');
    roomView.classList.remove('hidden');
    renderHeader();
    renderRoom();
    startRoomPolling();
    setBusy(false);
    if (!quiet) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function startRoomPolling() {
    if (roomPollTimer) window.clearInterval(roomPollTimer);
    roomPollTimer = window.setInterval(async () => {
      if (!state.user || !state.room || state.busy || document.hidden) return;
      // No reemplazamos la pantalla mientras una persona está escribiendo una idea de regalo.
      if (document.activeElement?.id === 'gift-message') return;
      try {
        const previousStatus = state.room.status;
        const previousCount = state.participants.length;
        const previousNewestMessage = state.messages[0]?.id || null;
        const { data: latestRoom, error: roomError } = await state.client
          .from('rooms').select('id,name,invite_code,owner_id,status,created_at,closed_at,drawn_at')
          .eq('id', state.room.id).maybeSingle();
        if (roomError || !latestRoom) return;
        const { data: currentMembers, error: membersError } = await state.client
          .from('participants').select('user_id').eq('room_id', state.room.id);
        if (membersError) return;
        let changed = latestRoom.status !== previousStatus || (currentMembers || []).length !== previousCount;
        if (!changed && latestRoom.status === 'drawn' && state.ownParticipant?.accepted_at) {
          const { data: latestMessage } = await state.client
            .from('gift_messages').select('id').eq('room_id', state.room.id)
            .order('created_at', { ascending: false }).limit(1).maybeSingle();
          if ((latestMessage?.id || null) !== previousNewestMessage) changed = true;
        }
        if (changed) {
          state.room = latestRoom;
          await loadRoomData();
          renderRoom();
          if (latestRoom.status !== previousStatus) {
            if (latestRoom.status === 'closed') toast('El organizador cerró las inscripciones. ¡Ya pueden sortear!');
            if (latestRoom.status === 'drawn') toast('El sorteo ya está guardado. Puedes girar para revelar tu resultado.');
          }
        }
      } catch (error) {
        // Un fallo puntual de red no debe interrumpir la sala; el siguiente ciclo lo volverá a intentar.
        console.debug('Actualización periódica no completada:', error?.message || error);
      }
    }, 15000);
  }

  async function loadRoomData() {
    if (!state.user || !state.room) return;
    const { data: roomRow, error: roomError } = await state.client
      .from('rooms').select('id,name,invite_code,owner_id,status,created_at,closed_at,drawn_at')
      .eq('id', state.room.id).maybeSingle();
    if (roomError) throw roomError;
    if (!roomRow) throw new Error('No se pudo cargar la sala. Verifica tu inscripción y vuelve a entrar.');
    state.room = roomRow;

    const { data: participants, error: participantsError } = await state.client
      .from('participants').select('room_id,user_id,joined_at,accepted_at')
      .eq('room_id', state.room.id).order('joined_at', { ascending: true });
    if (participantsError) throw participantsError;
    state.ownParticipant = (participants || []).find(item => item.user_id === state.user.id) || null;
    const ids = (participants || []).map(item => item.user_id);
    let profileRows = [];
    if (ids.length) {
      const { data, error } = await state.client.from('profiles').select('id,full_name').in('id', ids);
      if (error) throw error;
      profileRows = data || [];
    }
    const profileMap = new Map(profileRows.map(profile => [profile.id, profile]));
    state.participants = (participants || []).map(item => ({
      ...item,
      full_name: profileMap.get(item.user_id)?.full_name || 'Participante'
    }));
    state.profile = profileMap.get(state.user.id) || { full_name: state.user.user_metadata?.full_name || state.user.email };

    state.assignmentId = null;
    state.assignmentName = null;
    if (state.room.status === 'drawn') {
      const { data: assignment, error: assignmentError } = await state.client
        .from('assignments').select('receiver_id')
        .eq('room_id', state.room.id).eq('giver_id', state.user.id).maybeSingle();
      if (assignmentError) throw assignmentError;
      if (assignment) {
        state.assignmentId = assignment.receiver_id;
        state.assignmentName = profileMap.get(assignment.receiver_id)?.full_name || 'Tu amigo secreto';
      }
      const { data: messages, error: messagesError } = await state.client
        .from('gift_messages').select('id,author_id,message,created_at')
        .eq('room_id', state.room.id).order('created_at', { ascending: false }).limit(75);
      if (messagesError) throw messagesError;
      state.messages = (messages || []).map(message => ({
        ...message,
        author_name: profileMap.get(message.author_id)?.full_name || 'Participante'
      }));
    } else {
      state.messages = [];
    }
  }

  function participantListHtml() {
    if (!state.participants.length) return '<div class="empty-state"><span class="empty-icon">👋</span>Aún no hay participantes.</div>';
    return `<div class="participant-list">${state.participants.map(person => `
      <div class="participant-chip">
        <span class="avatar" aria-hidden="true">${escapeHtml(initials(person.full_name))}</span>
        <span class="participant-name">${escapeHtml(person.full_name)}${person.user_id === state.user.id ? '<span class="you">Tú</span>' : ''}</span>
      </div>`).join('')}</div>`;
  }

  function roomToplineHtml() {
    const statusLabel = state.room.status === 'open' ? 'Inscripciones abiertas' : state.room.status === 'closed' ? 'Inscripciones cerradas' : 'Sorteo realizado';
    return `<div class="room-topline view-enter">
      <div><span class="room-badge"><span class="dot"></span>${statusLabel}</span><h1 class="room-title">${escapeHtml(state.room.name)}</h1><p class="room-subtitle">Una sala para compartir la alegría de regalar. Invita a los participantes que faltan y revisa las indicaciones.</p></div>
      <div class="room-code-box"><div class="room-code-text"><small>CÓDIGO DE INVITACIÓN</small><strong>${escapeHtml(state.room.invite_code)}</strong></div><button type="button" class="btn btn-secondary" data-action="share-room">Compartir ↗</button></div>
    </div>`;
  }

  function openRoomHtml() {
    const isOwner = state.room.owner_id === state.user.id;
    const canClose = isOwner && state.participants.length >= 2;
    return `${roomToplineHtml()}
      <div class="room-grid view-enter">
        <section class="panel-card">
          <div class="panel-heading"><div><h3>¿Quiénes van a jugar?</h3><p class="muted">Todos los nombres de esta lista participan en el sorteo.</p></div><span class="count">${state.participants.length}</span></div>
          ${participantListHtml()}
          <p class="room-notes">💡 Comparte el código o el enlace de invitación por el chat familiar. Nadie necesita instalar una aplicación.</p>
        </section>
        <section class="panel-card status-panel">
          <span class="status-icon" aria-hidden="true">${isOwner ? '🎄' : '💌'}</span>
          <span class="small-label">PASO 1 DE 2</span>
          <h3>${isOwner ? 'Tu sala ya está creada' : '¡Ya estás dentro!'}</h3>
          <p>${isOwner ? 'Cuando confirmes que todos están en la lista, cierra las inscripciones. Después, cualquier participante podrá iniciar el sorteo.' : 'Espera a que el organizador cierre las inscripciones. Cuando la sala esté lista, podrás girar tu ruleta para descubrir a quién regalarás.'}</p>
          ${isOwner ? `<button type="button" class="btn btn-primary btn-full" data-action="close-room" ${canClose ? '' : 'disabled'}>Cerrar inscripciones</button>${canClose ? '' : '<p class="room-notes" style="color:#e7eddf">Necesitan al menos 2 participantes para cerrar la sala.</p>'}` : '<div class="notice-inline">El organizador todavía puede invitar a más personas. La página revisa el estado de la sala automáticamente.</div>'}
        </section>
      </div>`;
  }

  function closedRoomHtml() {
    const alreadyDrawn = state.room.status === 'drawn';
    return `${roomToplineHtml()}
      <section class="roulette-wrap view-enter"><div class="roulette-card">
        <div class="roulette-confetti" aria-hidden="true">✦ ✧ ✦</div>
        <p class="section-kicker">PASO 2 · EL MOMENTO DEL SORTEO</p>
        <h2>¿A quién le darás una sonrisa?</h2>
        <p class="muted">${alreadyDrawn ? 'El sorteo de la sala ya está guardado. Gira para revelar únicamente tu asignación privada; no se generará otro sorteo.' : 'Las inscripciones están cerradas. Pulsa el botón para generar una sola vez el sorteo de toda la sala y descubrir de forma privada tu amigo secreto.'}</p>
        <div class="roulette-screen"><span class="roulette-arrow" aria-hidden="true">▼</span><span class="screen-caption">Tu amigo secreto será...</span><span class="screen-name">¿Quién será?</span></div>
        <p class="roulette-status">Hay ${state.participants.length} participantes. ${alreadyDrawn ? 'Las asignaciones ya están guardadas.' : 'Las asignaciones se guardarán una sola vez.'} Cada persona recibe a alguien distinto.</p>
        <button type="button" class="btn btn-primary" data-action="spin" style="min-width:min(100%,270px);margin-top:13px">🎁 Girar y descubrir</button>
      </div></section>
      <div class="room-grid section-gap"><section class="panel-card"><div class="panel-heading"><div><h3>Participantes del sorteo</h3><p class="muted">Esta es la lista que se usará para asignar los regalos.</p></div><span class="count">${state.participants.length}</span></div>${participantListHtml()}</section><section class="panel-card"><h3>Todo listo</h3><p class="muted">Puedes tomarte un momento antes de girar. El resultado quedará guardado y podrás volver a consultarlo después de iniciar sesión.</p></section></div>`;
  }

  function revealedHtml() {
    return `${roomToplineHtml()}
      <section class="roulette-wrap view-enter"><div class="roulette-card">
        <div class="roulette-confetti" aria-hidden="true">✦ ✧ ✦</div><p class="section-kicker">¡YA TIENES TU ASIGNACIÓN!</p><h2>Tu amigo secreto es...</h2>
        <div class="result-callout"><span class="result-label">TE TOCA REGALARLE A</span><h3 class="result-name">${escapeHtml(state.assignmentName || 'Tu amigo secreto')}</h3><p>Guarda el secreto para que la sorpresa sea completa. 🤫</p></div>
        <p class="roulette-status">Tu resultado ya está guardado de forma privada. Al aceptar, pasarás a tu panel principal.</p>
        <button type="button" class="btn btn-primary" data-action="accept-assignment">Aceptar y continuar <span aria-hidden="true">→</span></button>
      </div></section>`;
  }

  function messagesHtml() {
    if (!state.messages.length) return '<div class="empty-state"><span class="empty-icon">💌</span>Aún no hay ideas de regalo.<br>Sé el primero en compartir una.</div>';
    return `<div class="messages-list">${state.messages.map(message => `
      <article class="message-card"><div class="message-meta"><span class="message-author">${escapeHtml(message.author_name)}</span><time class="message-date" datetime="${escapeHtml(message.created_at)}">${escapeHtml(niceDate(message.created_at))}</time></div><p class="message-body">${escapeHtml(message.message)}</p></article>`).join('')}</div>`;
  }

  function dashboardHtml() {
    const owner = state.room.owner_id === state.user.id;
    return `${roomToplineHtml()}
      <div class="dashboard-heading view-enter"><div><p class="section-kicker">TU PANEL PRINCIPAL</p><h1>¡Hola, ${escapeHtml(state.profile?.full_name || 'familia')}! <span aria-hidden="true">🎄</span></h1><p>Ya empezó la parte bonita: preparar una sorpresa para alguien especial.</p></div><span class="room-badge"><span class="dot"></span> Sorteo completado</span></div>
      <div class="dashboard-stats view-enter">
        <div class="stat-card"><span class="stat-icon" aria-hidden="true">👨‍👩‍👧‍👦</span><div><small>EN ESTA SALA</small><strong>${state.participants.length} participantes</strong></div></div>
        <div class="stat-card"><span class="stat-icon" aria-hidden="true">🎁</span><div><small>ESTADO DEL JUEGO</small><strong>Asignaciones listas</strong></div></div>
        <div class="stat-card"><span class="stat-icon" aria-hidden="true">${owner ? '🌟' : '💚'}</span><div><small>TU ROL</small><strong>${owner ? 'Organizador/a' : 'Participante'}</strong></div></div>
      </div>
      <div class="dashboard-grid view-enter">
        <div class="dashboard-column">
          <section class="panel-card my-secret-card"><span class="small-label">TU MISIÓN SECRETA</span><h3>Este año vas a sorprender a...</h3><div class="secret-name">${escapeHtml(state.assignmentName || 'Tu amigo secreto')}</div><p class="muted">Piensa en algo que le alegre el día. Recuerda mantener el nombre en secreto hasta la entrega de regalos.</p><div class="privacy-tip"><span aria-hidden="true">🔒</span><span>Solo tú puedes consultar esta asignación. Los demás participantes no pueden verla.</span></div></section>
          <section class="panel-card section-gap"><div class="panel-heading"><div><h3>Participantes de la sala</h3><p class="muted">Todos los nombres que entraron al sorteo.</p></div><span class="count">${state.participants.length}</span></div>${participantListHtml()}</section>
        </div>
        <div class="dashboard-column">
          <section class="panel-card"><div class="mini-heading"><div><h3>💝 Ideas para regalar</h3><p class="muted">Publica una idea para ayudar a quien te saque.</p></div></div>
            <form id="message-form" class="message-form"><label for="gift-message" class="muted">¿Qué te gustaría recibir?</label><textarea id="gift-message" class="message-input" name="message" maxlength="1000" rows="3" required placeholder="Ej. Me gustan las plantas, uso talla M, disfruto los libros..."></textarea><div class="message-composer-footer"><span id="message-count" class="char-counter">0 / 1000</span><button class="btn btn-primary" type="submit">Compartir idea ↑</button></div><p class="field-hint">Todos los participantes podrán leer tus mensajes. No escribas información privada.</p></form>
          </section>
          <section class="panel-card section-gap"><div class="mini-heading"><div><h3>Lo que quiere la familia</h3><p class="muted">Las ideas más recientes aparecen primero.</p></div></div><div id="messages-container">${messagesHtml()}</div></section>
        </div>
      </div>`;
  }

  function renderRoom() {
    if (!state.room || !state.user) return;
    authView.classList.add('hidden');
    roomView.classList.remove('hidden');
    if (state.room.status === 'open') roomView.innerHTML = openRoomHtml();
    else if (state.room.status === 'closed') roomView.innerHTML = closedRoomHtml();
    else if (state.ownParticipant?.accepted_at) roomView.innerHTML = dashboardHtml();
    else if (state.revealedThisVisit && state.assignmentName) roomView.innerHTML = revealedHtml();
    else roomView.innerHTML = closedRoomHtml();
    renderHeader();
  }

  async function closeRoom() {
    if (state.busy) return;
    if (!window.confirm('¿Confirmas que ya están todos? Después de cerrar no podrán entrar nuevos participantes.')) return;
    setBusy(true, 'Cerrando las inscripciones...');
    try {
      const { error } = await state.client.rpc('close_room', { p_room_id: state.room.id });
      if (error) throw error;
      await loadRoomData();
      state.revealedThisVisit = false;
      renderRoom();
      setBusy(false);
      toast('Inscripciones cerradas. ¡Ya pueden iniciar el sorteo!');
    } catch (error) {
      setBusy(false);
      toast(formatError(error), 'error');
    }
  }

  async function beginSpin() {
    if (state.busy) return;
    setBusy(true, 'Preparando el sorteo seguro...');
    try {
      const { error: drawError } = await state.client.rpc('draw_room', { p_room_id: state.room.id });
      if (drawError) throw drawError;
      await loadRoomData();
      if (!state.assignmentName) throw new Error('El sorteo se guardó, pero no pudimos recuperar tu resultado. Recarga la página e inténtalo de nuevo.');
      setBusy(false);
      renderRoom();
      const screen = roomView.querySelector('.roulette-screen');
      const name = roomView.querySelector('.screen-name');
      const status = roomView.querySelector('.roulette-status');
      const btn = roomView.querySelector('[data-action="spin"]');
      if (!screen || !name) {
        state.revealedThisVisit = true;
        renderRoom();
        return;
      }
      if (btn) btn.disabled = true;
      screen.classList.add('is-spinning');
      status.textContent = 'La ruleta está girando. ¡Que empiece la magia!';
      const names = state.participants.map(person => person.full_name).filter(Boolean);
      const duration = 5000;
      const start = Date.now();
      const interval = window.setInterval(() => {
        const randomName = names[Math.floor(Math.random() * names.length)] || 'Amigo secreto';
        name.textContent = randomName;
        const elapsed = Date.now() - start;
        if (elapsed >= duration) {
          window.clearInterval(interval);
          name.textContent = state.assignmentName;
          screen.classList.remove('is-spinning');
          status.textContent = '¡Sorpresa! Tu asignación se guardó correctamente.';
          state.revealedThisVisit = true;
          window.setTimeout(() => renderRoom(), 650);
        }
      }, 85);
    } catch (error) {
      setBusy(false);
      toast(formatError(error), 'error');
      try { await loadRoomData(); renderRoom(); } catch (_) { /* conserva el mensaje original */ }
    }
  }

  async function acceptAssignment() {
    if (state.busy) return;
    setBusy(true, 'Guardando que ya descubriste tu amigo secreto...');
    try {
      const { error } = await state.client.rpc('accept_assignment', { p_room_id: state.room.id });
      if (error) throw error;
      await loadRoomData();
      state.revealedThisVisit = false;
      setBusy(false);
      renderRoom();
      toast('¡Listo! Ya estás en tu panel principal.');
    } catch (error) {
      setBusy(false);
      toast(formatError(error), 'error');
    }
  }

  async function submitGiftMessage(form) {
    if (state.busy) return;
    const textarea = form.querySelector('[name="message"]');
    const message = String(textarea?.value || '').trim();
    if (!message) return toast('Escribe una idea antes de enviarla.', 'error');
    if (message.length > 1000) return toast('El mensaje debe tener máximo 1000 caracteres.', 'error');
    setBusy(true, 'Compartiendo tu idea con la familia...');
    try {
      const { error } = await state.client.from('gift_messages').insert({
        room_id: state.room.id,
        author_id: state.user.id,
        message
      });
      if (error) throw error;
      await loadRoomData();
      setBusy(false);
      renderRoom();
      toast('Tu idea quedó compartida con la familia.');
    } catch (error) {
      setBusy(false);
      toast(formatError(error), 'error');
    }
  }

  async function shareRoom() {
    const url = new URL(window.location.href);
    url.searchParams.set('sala', state.room.invite_code);
    const text = `¡Únete a mi sala de amigo secreto “${state.room.name}”! Abre este enlace y regístrate: ${url.toString()}\nCódigo de sala: ${state.room.invite_code}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Invitación a amigo secreto', text, url: url.toString() });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        toast('Invitación copiada. Ya puedes pegarla en WhatsApp.');
      } else {
        window.prompt('Copia y comparte esta invitación:', text);
      }
    } catch (error) {
      if (error?.name !== 'AbortError') toast('No se pudo compartir automáticamente. Copia el código que aparece en pantalla.', 'error');
    }
  }

  async function signOut() {
    if (state.busy) return;
    if (roomPollTimer) { window.clearInterval(roomPollTimer); roomPollTimer = null; }
    setBusy(true, 'Cerrando tu sesión...');
    const { error } = await state.client.auth.signOut();
    setBusy(false);
    if (error) return toast(formatError(error), 'error');
    state.user = null;
    state.room = null;
    state.profile = null;
    state.participants = [];
    state.ownParticipant = null;
    state.assignmentId = null;
    state.assignmentName = null;
    state.messages = [];
    state.revealedThisVisit = false;
    showAuth('login', 'Sesión cerrada correctamente.', 'success');
  }

  roomView.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    if (action === 'close-room') await closeRoom();
    else if (action === 'spin') await beginSpin();
    else if (action === 'accept-assignment') await acceptAssignment();
    else if (action === 'share-room') await shareRoom();
    else if (action === 'signout') await signOut();
  });

  headerActions.addEventListener('click', async event => {
    if (event.target.closest('[data-action="signout"]')) await signOut();
  });

  roomView.addEventListener('submit', async event => {
    if (event.target.id === 'message-form') {
      event.preventDefault();
      await submitGiftMessage(event.target);
    }
  });

  roomView.addEventListener('input', event => {
    if (event.target.id === 'gift-message') {
      const counter = document.getElementById('message-count');
      if (counter) counter.textContent = `${event.target.value.length} / 1000`;
    }
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-action="back-to-login"]')) {
      window.history.replaceState({}, document.title, window.location.pathname);
      const resetForm = document.getElementById('reset-form');
      if (resetForm) resetForm.remove();
      tabs.forEach(tab => tab.classList.remove('hidden'));
      showAuth('login');
    }
  });

  // Normaliza los códigos pegados por los participantes.
  document.addEventListener('input', event => {
    if (event.target.matches('input[name="inviteCode"]')) {
      const start = event.target.selectionStart;
      event.target.value = event.target.value.toUpperCase().replace(/[^A-F0-9]/g, '').slice(0, 12);
      try { event.target.setSelectionRange(start, start); } catch (_) { /* algunos navegadores no permiten selección */ }
    }
  });

  init().catch(error => {
    console.error(error);
    setBusy(false);
    showAuth('login', `No se pudo iniciar la aplicación: ${formatError(error)}`, 'error');
  });
})();
