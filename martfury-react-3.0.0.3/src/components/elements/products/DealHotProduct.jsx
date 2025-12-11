import React from 'react';
import { Progress } from 'antd';
import Rating from '~/components/elements/Rating';
import CountDown from '~/components/elements/CountDown';
import ThumbnailWithBadge from '~/components/elements/detail/thumbnail/ThumbnailWithBadge';
import useProduct from '~/hooks/useProduct';

const DealHotProduct = ({ product }) => {
    const { getHeadingPrice, title } = useProduct(
        product.attributes,
        product.id
    );

    return (
        <div className="ps-product--detail ps-product--hot-deal">
            <div className="ps-product__header">
                <ThumbnailWithBadge product={product} />
                <div className="ps-product__info">
                    <h5>Investor</h5>
                    <h3 className="ps-product__name">{title}</h3>
                    <div className="ps-product__meta">
                        {getHeadingPrice}
                        <div className="ps-product__rating">
                            <Rating />
                            <span>(1 review)</span>
                        </div>
                        <div className="ps-product__specification">
                            <p>
                                Status:
                                <strong className="in-stock">In Stock</strong>
                            </p>
                        </div>
                    </div>
                    <div className="ps-product__expires">
                        <p>Expires In</p>
                        <CountDown
                            timeTillDate="12 31 2024, 6:00 am"
                            timeFormat="MM DD YYYY, h:mm a"
                        />
                    </div>
                    <div className="ps-product__processs-bar">
                        <Progress percent={60} showInfo={false} />
                        <p>
                            <strong>4/79</strong> Sold
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DealHotProduct;
