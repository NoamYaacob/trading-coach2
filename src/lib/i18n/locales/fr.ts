import type { BotLocale } from "../types";

export const fr: BotLocale = {
  keyboard: {
    checkIn: "Check-in",
    fomo: "J'ai le FOMO",
    revenge: "Je veux récupérer",
    justLost: "Je viens de perdre",
    lostTwice: "Perdu deux fois",
    angry: "Je suis en colère",
    outOfControl: "Je perds le contrôle",
    calmingDown: "Je me calme",
    backInControl: "Je reprends le contrôle",
    daySummary: "Résumé du jour",
    ruleLimits: "Mes limites aujourd'hui",
  },
  system: {
    invalidLink:
      "Ce lien est invalide ou expiré. Créez un nouveau lien depuis votre tableau de bord.",
    connectSuccess: "Telegram connecté. L'accès au coach est actif.",
    connectSuccessNoAccess:
      "Telegram connecté, mais l'accès est inactif. Vous avez besoin d'un plan ou essai actif.",
    connectSuccessIncomplete:
      "Telegram connecté. Complétez l'intégration sur le site web avant d'utiliser le bot.",
    notLinked:
      "Ce compte Telegram n'est pas lié. Connectez-le depuis votre tableau de bord.",
    onboardingIncomplete:
      "Votre compte est connecté mais l'intégration est incomplète. Terminez-la sur le site web.",
    accessInactive:
      "Votre accès est inactif. Activez un plan sur le site web pour continuer.",
    inputPlaceholder: "Action rapide ou message...",
    languageUpdated: "Langue mise à jour en français.",
  },
  prompts: {
    sessionNotStarted: "La session n'a pas encore commencé. Prêt quand vous l'êtes.",
    checkIn: "Comment vous sentez-vous avant la session d'aujourd'hui ?",
    review: "Comment s'est passée votre journée ? Qu'avez-vous appris ?",
  },
  coaching: {
    loss: "Une perte s'est produite. Respirez et réfléchissez avant le prochain mouvement.",
    fomo: "Le FOMO est l'ennemi de la discipline. Le marché reviendra toujours.",
    anger: "Trader en colère coûte de l'argent réel. Éloignez-vous maintenant.",
    noSetup: "Pas de setup, pas de trade. C'est ça, la discipline.",
    revenge:
      "Le trading de vengeance détruit les comptes. Votre prochain trade doit être propre.",
    overtrading: "Plus de trades signifie moins de contrôle. Moins c'est plus.",
    warning: "Attention, vous approchez de votre limite.",
    discipline: "Vos règles existent pour une raison. Respectez-les.",
  },
};
