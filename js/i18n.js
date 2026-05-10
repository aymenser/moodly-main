// ==============================================
// i18n.js — Internationalization & translations
// Moodly · ING 3 Refactoring
// ==============================================

const translations = {
  fr: {
    nav: {
      home:      'Accueil',
      shop:      'Boutique',
      nouveautes:'Nouveautés',
      histoire:  'Notre Histoire',
      connexion: 'Connexion',
    },
    cart: {
      empty:    'Votre panier est vide',
      emptySub: 'Commencez à shopper !',
      total:    'Total',
      checkout: 'Commander maintenant',
      continue: 'Continuer mes achats',
      promo:    'Code promo',
      apply:    'Appliquer',
    },
    wishlist: {
      empty:    'Aucun favori pour l\'instant',
      emptySub: 'Coeur les articles qui vous plaisent !',
    },
    toasts: {
      addedCart:    (name) => `"${name}" ajouté au panier 🛒`,
      removedWish:  'Retiré des favoris',
      addedWish:    (name) => `"${name}" ajouté aux favoris ❤️`,
      orderPlaced:  'Commande passée ! On vous contacte bientôt 🚀',
      promoApplied: 'Code appliqué ! 🎉',
      newsletter:   'Merci ! Vous êtes inscrite. 🎉',
      loggedIn:     (name) => `Bienvenue, ${name} ! 👋`,
      signedUp:     'Compte créé avec succès ! Bienvenue chez Moodly 🎉',
      loggedOut:    'À bientôt ! 👋',
    },
    auth: {
      signin:      'Se connecter',
      signup:      'S\'inscrire',
      modalTitle:  'Bon retour ! 👋',
      modalTitleReg: 'Rejoignez-nous ✨',
      modalSub:    'Connectez-vous pour accéder à vos favoris et commandes.',
      modalSubReg: 'Créez votre compte Moodly gratuitement.',
      emailPlaceholder:    'Votre email',
      passwordPlaceholder: 'Mot de passe',
      namePlaceholder:     'Votre prénom',
      logout:      'Se déconnecter',
    },
    filters: {
      all:      'Tout',
      category: 'Catégorie',
      size:     'Taille',
      color:    'Couleur',
      maxPrice: 'Prix maximum (DA)',
      apply:    'Appliquer les filtres',
      search:   'Rechercher un article...',
      sort:     {
        new:          'Nouveautés',
        priceAsc:     'Prix croissant',
        priceDesc:    'Prix décroissant',
        bestSellers:  'Meilleures ventes',
      },
    },
    badges: {
      new:  'Nouveau',
      low:  'Bientôt épuisé',
      out:  'Rupture',
    },
    products: {
      addToCart:    'Ajouter au panier',
      addToWish:    'Ajouter aux favoris',
      removeFromWish: 'Retirer des favoris',
      alsoLike:     'Vous aimerez aussi',
      quantity:     'Quantité',
      color:        'Couleur',
      size:         'Taille',
      loading:      'Chargement...',
      noProducts:   'Aucun produit disponible.',
      noResults:    'Aucun produit trouvé.',
    },
  },
  // if we wanna add an additional languages here — same shape as 'fr'
  // en: { ... }
};

let currentLang = 'fr';

export function setLang(lang) {
  if (translations[lang]) currentLang = lang;
}

export function t(path) {
  const keys  = path.split('.');
  let   node  = translations[currentLang];
  for (const k of keys) {
    if (node === undefined) return path;
    node = node[k];
  }
  return node ?? path;
}
