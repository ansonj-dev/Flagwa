from alembic import context
from geoalchemy2 import Geometry

from app.database.session import get_engine
from app import models

target_metadata = models.Location.metadata


def include_object(obj, name, type_, reflected, compare_to):
    return type_ != "table" or name in target_metadata.tables


def render_item(type_, obj, autogen_context):
    if type_ == "type" and isinstance(obj, Geometry):
        return f"geoalchemy2.Geometry(geometry_type={obj.geometry_type!r}, srid={obj.srid}, spatial_index=False)"
    return False


if context.is_offline_mode():
    context.configure(dialect_name="postgresql", target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with get_engine().connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata,
                  include_object=include_object, render_item=render_item)
        with context.begin_transaction():
            context.run_migrations()