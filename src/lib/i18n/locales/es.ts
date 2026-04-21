import type { BotLocale } from "../types";

export const es: BotLocale = {
  keyboard: {
    checkIn: "Check-in",
    fomo: "Tengo FOMO",
    revenge: "Quiero recuperar",
    justLost: "Acabo de perder",
    lostTwice: "Perdí dos veces",
    angry: "Estoy enojado",
    outOfControl: "Sin control",
    calmingDown: "Me estoy calmando",
    backInControl: "Recuperé el control",
    daySummary: "Resumen del día",
    ruleLimits: "Mis límites hoy",
  },
  system: {
    invalidLink:
      "Este enlace no es válido o ha expirado. Crea un nuevo enlace desde el panel de tu sitio web.",
    connectSuccess: "Telegram conectado. El acceso al coach está activo.",
    connectSuccessNoAccess:
      "Telegram conectado, pero el acceso está inactivo. Necesitas un plan o prueba activa.",
    connectSuccessIncomplete:
      "Telegram conectado. Completa el onboarding en el sitio web antes de usar el bot.",
    notLinked:
      "Esta cuenta de Telegram no está vinculada. Conéctala desde el panel de tu sitio web.",
    onboardingIncomplete:
      "Tu cuenta está conectada pero el onboarding está incompleto. Complétalo en el sitio web.",
    accessInactive:
      "Tu acceso está inactivo. Activa un plan en el sitio web para continuar.",
    inputPlaceholder: "Acción rápida o mensaje...",
    languageUpdated: "Idioma actualizado al español.",
  },
  prompts: {
    sessionNotStarted: "La sesión aún no ha comenzado. Listo cuando tú lo estés.",
    checkIn: "¿Cómo te sientes antes de la sesión de hoy?",
    review: "¿Cómo fue tu día? ¿Qué aprendiste?",
  },
  coaching: {
    loss: "Ocurrió una pérdida. Respira y piensa antes de tu próximo movimiento.",
    fomo: "El FOMO es el enemigo de la disciplina. El mercado siempre vuelve.",
    anger: "Operar enojado cuesta dinero real. Aléjate ahora.",
    noSetup: "Sin setup no hay entrada. Eso es la disciplina.",
    revenge: "El trading de venganza destruye cuentas. Tu próxima operación debe ser limpia.",
    overtrading: "Más operaciones significa menos control. Menos es más.",
    warning: "Atención, te estás acercando a tu límite.",
    discipline: "Tus reglas existen por una razón. Respétalas.",
  },
  commands: {
    welcome:
      "Bienvenido a Guardrail Coach. Usa el menú de abajo o escribe un mensaje. /checkin para empezar tu día, /review para el resumen del día, /limits para tus reglas, /help para todos los comandos.",
    help:
      "Comandos disponibles:\n/checkin — check-in antes de la sesión\n/review — resumen de fin de día\n/limits — tus límites de riesgo hoy\n/help — este mensaje\n\nO simplemente escribe cómo te sientes y el coach responderá.",
    unknownCommand:
      "No reconocí ese comando. Usa /help para ver lo disponible, o simplemente escribe un mensaje.",
  },
};
