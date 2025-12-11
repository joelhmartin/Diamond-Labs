import React, { useMemo } from 'react';
import Link from 'next/link';

const ModuleProductDetailDescription = ({ product }) => {
    const { product_store } = product.attributes;

    const vendor = useMemo(() => {
        if (product) return 'No Vendor';
        return product_store
            ? product_store.data.attributes.title
            : 'No Vendor';
    }, [product_store]);

    return (
        <div className="ps-product__desc">
            <p>
                Sold By:
                <Link href={'/shop'}>
                    <strong> {vendor}</strong>
                </Link>
            </p>
            <ul className="ps-list--dot">
                <li>Unrestrained and portable active stereo speaker</li>
                <li> Free from the confines of wires and chords</li>
                <li> 20 hours of portable capabilities</li>
                <li>Double-ended Coil Cord with 3.5mm Stereo Plugs Included</li>
                <li> 3/4″ Dome Tweeters: 2X and 4″ Woofer: 1X</li>
            </ul>
        </div>
    );
};

export default ModuleProductDetailDescription;
