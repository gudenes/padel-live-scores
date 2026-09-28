export type BetaLocale = 'en' | 'es' | 'pt'

export function betaLocale(locale: string): BetaLocale {
  return locale === 'es' || locale === 'pt' ? locale : 'en'
}

export const betaCopy = {
  en: {
    starts: 'Starts October 10', closes: 'Signups close in', closed: 'Signups are closed', closedText: 'Registration for this beta has ended. Thank you for your interest!', days: 'd', hours: 'h', minutes: 'm', seconds: 's', preview: 'A first look at Padel Predict', previewNote: 'Design preview · sample markets and values', jump: 'Join the beta',
    label: 'Closed beta', title: 'Know padel? Put your predictions to the test.',
    intro: 'Help shape Padel Predictor Market, a prediction game for padel fans. Make predictions about matches and tournaments using virtual currency. No real money, no deposits, no cash withdrawals.',
    duration: '3 weeks', durationText: 'Play during the three-week beta and try out the game as you follow the action.',
    feedback: '15 minutes of feedback', feedbackText: 'Join one short interview to tell us what you enjoyed, what felt confusing, and what we could improve.',
    reward: 'Your beta thank-you', rewardText: 'Beta participants receive an exclusive in-game badge plus a one-year Pro subscription, making you eligible to win real prizes.',
    proYear: '1 year of Pro', badge: 'Exclusive beta badge', virtual: 'Virtual currency. Real padel knowledge.', rewardLabel: 'For beta participants',
    formTitle: 'Join the closed beta', formIntro: 'Leave your details and we’ll email you about access, the beta dates, and your feedback interview.',
    name: 'Your name', email: 'Email address', language: 'Preferred interview language',
    commitment: 'I’m happy to play during the three-week beta and take part in a 15-minute feedback interview.',
    contact: 'You can contact me by email about this beta and my feedback interview.',
    privacy: 'Privacy policy', submit: 'Sign me up', submitting: 'Signing you up…',
    successTitle: 'You’re on the list!', success: 'Thanks for helping shape the game. We’ll be in touch by email with the next steps.',
    error: 'We couldn’t save your signup. Please try again.', home: 'Back to Padel Nachos',
  },
  es: {
    starts: 'Empieza el 10 de octubre', closes: 'Inscripciones cierran en', closed: 'Inscripciones cerradas', closedText: 'El plazo de inscripción para esta beta ha terminado. ¡Gracias por tu interés!', days: 'd', hours: 'h', minutes: 'm', seconds: 's', preview: 'Así será Padel Predict', previewNote: 'Vista previa del diseño · mercados y valores de ejemplo', jump: 'Quiero participar',
    label: 'Beta cerrada', title: '¿Sabes de pádel? Pon a prueba tus predicciones.',
    intro: 'Ayúdanos a dar forma a Padel Predictor Market, un juego de predicciones para fans del pádel. Haz predicciones sobre partidos y torneos con moneda virtual. Sin dinero real, sin depósitos y sin retiradas de efectivo.',
    duration: '3 semanas', durationText: 'Juega durante las tres semanas de la beta y prueba el juego mientras sigues la competición.',
    feedback: '15 minutos para escucharte', feedbackText: 'Participa en una breve entrevista para contarnos qué te ha gustado, qué te ha resultado confuso y qué podríamos mejorar.',
    reward: 'Tu recompensa por participar', rewardText: 'Los participantes de la beta recibirán una insignia exclusiva dentro del juego y una suscripción Pro de un año, que les permitirá optar a premios reales.',
    proYear: '1 año de Pro', badge: 'Insignia exclusiva de la beta', virtual: 'Moneda virtual. Pasión real por el pádel.', rewardLabel: 'Para participantes de la beta',
    formTitle: 'Únete a la beta cerrada', formIntro: 'Déjanos tus datos y te escribiremos con información sobre el acceso, las fechas de la beta y tu entrevista.',
    name: 'Tu nombre', email: 'Correo electrónico', language: 'Idioma preferido para la entrevista',
    commitment: 'Me comprometo a jugar durante las tres semanas de la beta y a participar en una entrevista de 15 minutos para compartir mi opinión.',
    contact: 'Podéis contactarme por correo electrónico sobre esta beta y mi entrevista.',
    privacy: 'Política de privacidad', submit: 'Quiero participar', submitting: 'Guardando tu inscripción…',
    successTitle: '¡Ya estás en la lista!', success: 'Gracias por ayudarnos a dar forma al juego. Te escribiremos por correo electrónico con los próximos pasos.',
    error: 'No hemos podido guardar tu inscripción. Inténtalo de nuevo.', home: 'Volver a Padel Nachos',
  },
  pt: {
    starts: 'Começa em 10 de outubro', closes: 'Inscrições encerram em', closed: 'Inscrições encerradas', closedText: 'O prazo de inscrição para este beta terminou. Obrigado pelo interesse!', days: 'd', hours: 'h', minutes: 'm', seconds: 's', preview: 'Conheça o Padel Predict', previewNote: 'Prévia do design · mercados e valores de exemplo', jump: 'Quero participar',
    label: 'Beta fechado', title: 'Entende de padel? Coloque suas previsões à prova.',
    intro: 'Ajude a criar o Padel Predictor Market, um jogo de previsões para fãs de padel. Faça previsões sobre partidas e torneios usando moeda virtual. Sem dinheiro real, sem depósitos e sem saques.',
    duration: '3 semanas', durationText: 'Jogue durante as três semanas do beta e experimente o jogo enquanto acompanha a competição.',
    feedback: '15 minutos para ouvir você', feedbackText: 'Participe de uma breve entrevista para contar o que gostou, o que achou confuso e o que podemos melhorar.',
    reward: 'Sua recompensa por participar', rewardText: 'Os participantes do beta receberão um emblema exclusivo no jogo e uma assinatura Pro de um ano, que permitirá concorrer a prêmios reais.',
    proYear: '1 ano de Pro', badge: 'Emblema exclusivo do beta', virtual: 'Moeda virtual. Paixão real pelo padel.', rewardLabel: 'Para participantes do beta',
    formTitle: 'Participe do beta fechado', formIntro: 'Deixe seus dados e enviaremos um e-mail com informações sobre o acesso, as datas do beta e sua entrevista.',
    name: 'Seu nome', email: 'E-mail', language: 'Idioma preferido para a entrevista',
    commitment: 'Estou disponível para jogar durante as três semanas do beta e participar de uma entrevista de 15 minutos para compartilhar minha opinião.',
    contact: 'Podem entrar em contato comigo por e-mail sobre este beta e minha entrevista.',
    privacy: 'Política de privacidade', submit: 'Quero participar', submitting: 'Enviando sua inscrição…',
    successTitle: 'Você está na lista!', success: 'Obrigado por ajudar a criar o jogo. Enviaremos os próximos passos por e-mail.',
    error: 'Não foi possível salvar sua inscrição. Tente novamente.', home: 'Voltar ao Padel Nachos',
  },
} as const
