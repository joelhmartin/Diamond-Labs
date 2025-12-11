import React from 'react';
import Link from 'next/link';

const ConsummerElectronics = ({ data }) => (
    <div className="ps-block--categories-box">
        <div className="ps-block__header">
            <h3>Consumer Electronics</h3>
            <ul>
                <li>
                    <Link href={'/shop'}>New Arrivals</Link>
                </li>
                <li>
                    <Link href={'/shop'}>Best Sellers</Link>
                </li>
            </ul>
        </div>
        <div className="ps-block__content">
            {data &&
                data.map((category) => {
                    if (category.type === 'large') {
                        return (
                            <div
                                className="ps-block__banner"
                                key={category.text}>
                                <img src={category.imagePath} alt="martfury" />
                            </div>
                        );
                    } else {
                        return (
                            <div className="ps-block__item" key={category.text}>
                                <Link
                                    href={'/shop'}
                                    className="ps-block__overlay"
                                />
                                <img src={category.imagePath} alt="martfury" />
                                <p>{category.text} </p>
                                <span>{category.item} Items</span>
                            </div>
                        );
                    }
                })}
        </div>
    </div>
);

export default ConsummerElectronics;
