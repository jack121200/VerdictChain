"""Confirms docker-compose's Redis and RabbitMQ are actually reachable, not just
declared in the compose file — 'brings up Postgres/Redis/RabbitMQ' is only true if
this passes against a running stack.
"""

import pika
import redis

from backend.config import settings


def test_redis_ping():
    client = redis.Redis.from_url(settings.redis_url)
    assert client.ping() is True


def test_rabbitmq_connection():
    params = pika.URLParameters(settings.rabbitmq_url)
    connection = pika.BlockingConnection(params)
    assert connection.is_open
    connection.close()
