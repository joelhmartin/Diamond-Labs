import React from 'react';
import Link from 'next/link';
import WideProductActions from '~/components/elements/products/modules/WideProductActions';
import useProduct from '~/hooks/useProduct';

const WideProduct = ({ product }) => {
    const { thumbnailImage, price, title, badge } = useProduct(
        product.attributes
    );

    return (
        <div className="ps-product ps-product--wide">
            <div className="ps-product__thumbnail">
                <Link href={'/product/[pid]'} as={`/product/${product.id}`}>
                    {thumbnailImage}
                </Link>
            </div>
            <div className="ps-product__container">
                <div className="ps-product__content">
                    {title}
                    <p className="ps-product__vendor">
                        Sold by:
                        <Link href={'/shop'}>{product.vendor}</Link>
                    </p>
                    <ul className="ps-product__desc">
                        <li>Unrestrained and portable active stereo speaker</li>
                        <li> Free from the confines of wires and chords</li>
                        <li> 20 hours of portable capabilities</li>
                        <li>
                            Double-ended Coil Cord with 3.5mm Stereo Plugs
                            Included
                        </li>
                        <li> 3/4″ Dome Tweeters: 2X and 4″ Woofer: 1X</li>
                    </ul>
                </div>
                <WideProductActions product={product} />
            </div>
        </div>
    );
};

export default WideProduct;
