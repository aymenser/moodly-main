// ==============================================
// state-manager.js — Centralized shared state
// Moodly · Single source of truth
// ==============================================

import { getCurrentProfile, normalizeCartItems, normalizeWishlistItems } from './api.js';

// ---- Core State ----
let state = {
    user: null,
    profile: null,
    isLoggedIn: false,
    cartItems: [],
    wishlistItems: [],
    cartOrder: null,
    allProducts: [],
    currentProduct: null,
};

let listeners = [];

// ---- State Management ----
export function getState() {
    return { ...state };
}

export function getStateSnapshot() {
    return state;
}

export function setState(updates) {
    const previous = { ...state };
    state = { ...state, ...updates };
    notifyListeners(previous, state);
}

export function subscribe(listener) {
    listeners.push(listener);
    return () => {
        listeners = listeners.filter(l => l !== listener);
    };
}

function notifyListeners(previous, current) {
    listeners.forEach(listener => {
        try {
            listener(previous, current);
        } catch (err) {
            console.error('State listener error:', err);
        }
    });
}

// ---- Cart Operations ----
export function updateCartItems(order) {
    const normalized = normalizeCartItems(order, state.allProducts);
    setState({
        cartItems: normalized,
        cartOrder: order
    });
    return normalized;
}

export function addCartItem(item) {
    const items = [...state.cartItems, item];
    setState({ cartItems: items });
    return items;
}

export function removeCartItem(id) {
    const items = state.cartItems.filter(item =>
        String(item.id) !== String(id) && String(item.cartItemId) !== String(id)
    );
    setState({ cartItems: items });
    return items;
}

export function clearCart() {
    setState({ cartItems: [], cartOrder: null });
}

// ---- Wishlist Operations ----
export function updateWishlistItems(rows) {
    const normalized = normalizeWishlistItems(rows, state.allProducts);
    setState({ wishlistItems: normalized });
    return normalized;
}

export function addWishlistItem(item) {
    const items = [...state.wishlistItems, item];
    setState({ wishlistItems: items });
    return items;
}

export function removeWishlistItem(id) {
    const items = state.wishlistItems.filter(item => String(item.id) !== String(id));
    setState({ wishlistItems: items });
    return items;
}

// ---- User Operations ----
export function setUser(user, profile) {
    setState({
        user: user || null,
        profile: profile || null,
        isLoggedIn: Boolean(user && profile),
    });
}

export function clearUser() {
    setState({
        user: null,
        profile: null,
        isLoggedIn: false,
        cartItems: [],
        wishlistItems: [],
        cartOrder: null,
    });
}

// ---- Product Operations ----
export function setAllProducts(products) {
    setState({ allProducts: products });
}

export function getProduct(id) {
    return state.allProducts.find(p => String(p.id) === String(id));
}

export function setCurrentProduct(product) {
    setState({ currentProduct: product });
}

// ---- Convenience Getters ----
export function isLoggedIn() {
    return state.isLoggedIn;
}

export function getCartItems() {
    return state.cartItems;
}

export function getWishlistItems() {
    return state.wishlistItems;
}

export function getUserProfile() {
    return state.profile;
}