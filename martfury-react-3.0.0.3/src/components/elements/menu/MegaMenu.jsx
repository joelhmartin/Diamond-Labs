import React from 'react';
import Link from 'next/link';

const MegaMenuColumn = ({ item }) => (
    <div className="mega-menu__column" key={item.heading}>
        <h4>{item.heading}</h4>
        <ul className="mega-menu__list">
            {item.megaItems.map((subItem) => (
                <li key={subItem.text}>
                    <Link href={subItem.url} as={subItem.url}>
                        {subItem.text}
                    </Link>
                </li>
            ))}
        </ul>
    </div>
);

const MegaMenu = ({ source }) => {
    if (!source || !source.megaContent) {
        return null; // or some fallback UI
    }

    return (
        <li className="menu-item-has-children has-mega-menu">
            <Link href={source.url || '/'}>
                {source.icon && <i className={source.icon} />}
                {source.text}
            </Link>
            <div className="mega-menu">
                {source.megaContent.map((item) => (
                    <MegaMenuColumn item={item} key={item.heading} />
                ))}
            </div>
        </li>
    );
};

export default MegaMenu;
