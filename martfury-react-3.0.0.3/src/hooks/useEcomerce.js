import { useState } from 'react';
import { useCookies } from 'react-cookie';
import { useDispatch } from 'react-redux';
import {
    changeCartItems,
    changeCompareItems,
    changeWishlistItems,
} from '~/redux/features/ecommerceSlide';
import { getStrapiEntriesService } from '~/services/strapi/strapiQueryServices';

const COLLECTION_TYPE = 'products';

export default function useEcomerce() {
    const dispatch = useDispatch();
    const [loading, setLoading] = useState(false);
    const [cartItemsOnCookie] = useState(null);
    const [cookies, setCookie] = useCookies(['cart']);
    const [products, setProducts] = useState([]);

    function handleGroupActions(items, group) {
        switch (group) {
            case 'cart':
                setCookie('cart', items, { path: '/' });
                dispatch(changeCartItems(items));
                break;
            case 'wishlist':
                setCookie('wishlist', items, { path: '/' });
                dispatch(changeWishlistItems(items));
                break;
            case 'compare':
                setCookie('compare', items, { path: '/' });
                dispatch(changeCompareItems(items));
                break;
            default:
        }
    }
    async function getProducts(payload, group = '') {
        setLoading(true);
        if (payload && payload.length > 0) {
            const query = {
                filters: {
                    id: {
                        $in: payload.map((p) => p.id),
                    },
                },
            };
            try {
                const response = await getStrapiEntriesService(
                    COLLECTION_TYPE,
                    query
                );
                if (response && response.length > 0) {
                    if (group === 'cart') {
                        let cartItems = response.data;
                        payload.forEach((item) => {
                            let existItem = cartItems.find(
                                (val) => val.id === item.id
                            );
                            if (existItem) {
                                existItem.quantity = item.quantity;
                            }
                        });
                        setProducts(response.data || []);
                    } else {
                        setProducts([]);
                    }
                    setTimeout(
                        function () {
                            setLoading(false);
                        }.bind(this),
                        250
                    );
                }
            } catch (error) {
                console.error('Error fetching products:', error);
                setProducts([]);
            } finally {
                setLoading(false);
            }
        } else {
            setLoading(false);
            setProducts([]);
        }
    }

    return {
        loading,
        cartItemsOnCookie,
        products,
        getProducts,
        increaseQty: (payload, currentCart) => {
            if (!currentCart) return [];
            const updatedCart = currentCart.map((item) => {
                if (item.id === payload.id) {
                    // Spread operator to clone the item and update its quantity
                    return { ...item, quantity: item.quantity + 1 };
                }
                return item;
            });
            setCookie('cart', updatedCart, { path: '/' });
            dispatch(changeCartItems(updatedCart));
            return updatedCart;
        },

        decreaseQty: (payload, currentCart) => {
            if (!currentCart) return [];
            const updatedCart = currentCart.map((item) => {
                if (item.id === payload.id) {
                    return { ...item, quantity: item.quantity - 1 };
                }
                return item;
            });

            setCookie('cart', updatedCart, { path: '/' });
            dispatch(changeCartItems(updatedCart));
            return updatedCart;
        },

        addItem: (newItem, items, group) => {
            const itemIndex = items.findIndex((item) => item.id === newItem.id);
            let updatedItems = [...items];
            if (itemIndex >= 0) {
                if (group === 'cart') {
                    updatedItems[itemIndex] = {
                        ...items[itemIndex],
                        quantity: items[itemIndex].quantity + newItem.quantity,
                    };
                }
            } else {
                updatedItems.push(newItem);
            }
            handleGroupActions(updatedItems, group);
            return updatedItems;
        },

        removeItem: (selectedItem, items, group) => {
            const index = items.findIndex(
                (item) => item.id === selectedItem.id
            );
            if (index !== -1) {
                const updatedItems = items.filter(
                    (item) => item.id !== selectedItem.id
                );
                handleGroupActions(updatedItems, group);
            }
        },
    };
}
